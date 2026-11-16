/* usp_AutoDeletePicklist_AndCloseAllocation_OnGPN_v2 — fix for the stale rule (16 Nov 2026).
   The first live run on 14 Nov 13:51 used the stale rule (last pick > 45 days ago, no GPN in 45 days)
   on jobs that were still on a machine's print schedule. It deleted their picks, so the print plan
   showed Picked = 0 for about 120 contents, CD102 - 6L and CD2008 among them.
   Change: the stale rule now skips any job that has a content in JobScheduleReleaseMachineWise (the
   live machine schedule), counting gang secondaries for their primary. If that table is empty (for
   example halfway through Auto_Schedule_Refresh) the stale rule is skipped for the whole run.
   GPN_OVER_THRESHOLD and JOB_CLOSED are unchanged.
   Run on the Kolkata IndusEnterprise database BEFORE undo_picklist_stale_autodelete_2026-11-14.sql. */

CREATE OR ALTER PROCEDURE dbo.usp_AutoDeletePicklist_AndCloseAllocation_OnGPN_v2
    @Threshold  DECIMAL(6,4) = 0.7500,  -- GPN_OVER_THRESHOLD: 0.75 = 75% of order qty
    @StaleDays  INT          = 45,      -- stale rule: no allocation and no GPN for this many days
    @DryRun     BIT          = 1,       -- 1 = report only, nothing written
    @CompanyID  INT          = NULL     -- NULL = all companies (as v1)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF ISNULL(@StaleDays, 0) <= 0
    BEGIN
        RAISERROR('@StaleDays must be greater than 0.', 16, 1);
        RETURN;
    END

    DECLARE @Today       DATE             = CAST(GETDATE() AS DATE);
    DECLARE @StaleCutoff DATE             = DATEADD(DAY, -@StaleDays, @Today);
    DECLARE @RunID       UNIQUEIDENTIFIER = NEWID();
    DECLARE @RunAt       DATETIME         = GETDATE();
    DECLARE @RunMode     VARCHAR(10)      = CASE WHEN @DryRun = 1 THEN 'DRYRUN' ELSE 'LIVE' END;

    -- same marker as v1: 14-Nov-2026 is stored as 14-Nov-1926
    DECLARE @AutoDeleteDate DATETIME =
        DATEFROMPARTS(1900 + (YEAR(@Today) % 100), MONTH(@Today), DAY(@Today));

    /* 1) Facts per job */
    SELECT
        JEJ.JobBookingID,
        MAX(JEJ.JobBookingNo)                         AS JobBookingNo,
        MAX(ISNULL(JEJ.OrderQuantity, 0))             AS OrderQty,
        MAX(CAST(ISNULL(JEJ.IsClose, 0) AS INT))      AS IsClosed
    INTO #Jobs
    FROM dbo.JobBookingJobCard AS JEJ
    WHERE ISNULL(JEJ.IsDeletedTransaction, 0) = 0
      AND (@CompanyID IS NULL OR JEJ.CompanyID = @CompanyID)
    GROUP BY JEJ.JobBookingID;

    SELECT
        fgd.JobBookingID,
        SUM(ISNULL(fgd.outercarton,0) * ISNULL(fgd.innercarton,0) * ISNULL(fgd.quantityperpack,0)) AS GpnUnits,
        MAX(CAST(fgm.VoucherDate AS DATE))            AS LastGPNDate
    INTO #GPN
    FROM dbo.FinishGoodsTransactionMain   AS fgm
    JOIN dbo.FinishGoodsTransactionDetail AS fgd
      ON fgd.FGTransactionID = fgm.FGTransactionID
    WHERE fgm.VoucherID = -50
      AND ISNULL(fgm.IsDeletedTransaction, 0) = 0
      AND ISNULL(fgd.IsDeletedTransaction, 0) = 0
    GROUP BY fgd.JobBookingID;

    -- gang: secondaries pack under their own JobBookingID while the allocation
    -- sits on the primary, so their GPN counts as activity for the primary
    -- (IsPrimaryJob = 1 marks a secondary row)
    SELECT
        GG.PrimaryJobBookingID                        AS JobBookingID,
        MAX(G.LastGPNDate)                            AS LastGangGPNDate
    INTO #GangGPN
    FROM dbo.JobBookingJobCardGang AS GG
    JOIN #GPN AS G
      ON G.JobBookingID = GG.jobBookingID
    WHERE GG.IsPrimaryJob = 1
      AND ISNULL(GG.IsDeletedTransaction, 0) = 0
    GROUP BY GG.PrimaryJobBookingID;

    SELECT
        JBC.JobBookingID,
        MAX(CAST(ITM.VoucherDate AS DATE))            AS LastAllocDate
    INTO #Alloc
    FROM dbo.ItemTransactionMain  AS ITM
    JOIN dbo.ItemTransactionDetail AS ITD
      ON ITD.TransactionID = ITM.TransactionID
    JOIN dbo.JobBookingJobCardContents AS JBC
      ON JBC.JobBookingJobCardContentsID = ITD.JobBookingJobCardContentsID
    WHERE ITM.VoucherID = -17
      AND ISNULL(ITM.IsDeletedTransaction, 0) = 0
      AND ISNULL(ITD.IsDeletedTransaction, 0) = 0
    GROUP BY JBC.JobBookingID;

    -- jobs on the live machine schedule are not stale, however old their pick:
    -- they are waiting their turn and the print plan still needs their picks.
    -- A secondary on the schedule protects its primary (where the allocation sits).
    DECLARE @ScheduleReady BIT =
        CASE WHEN EXISTS (SELECT 1 FROM dbo.JobScheduleReleaseMachineWise) THEN 1 ELSE 0 END;

    SELECT DISTINCT JBC.JobBookingID
    INTO #OnSchedule
    FROM dbo.JobScheduleReleaseMachineWise AS MW
    JOIN dbo.JobBookingJobCardContents AS JBC
      ON JBC.JobBookingJobCardContentsID = MW.JobBookingJobcardContentsID
    UNION
    SELECT GG.PrimaryJobBookingID
    FROM dbo.JobScheduleReleaseMachineWise AS MW
    JOIN dbo.JobBookingJobCardContents AS JBC
      ON JBC.JobBookingJobCardContentsID = MW.JobBookingJobcardContentsID
    JOIN dbo.JobBookingJobCardGang AS GG
      ON GG.jobBookingID = JBC.JobBookingID
    WHERE GG.IsPrimaryJob = 1
      AND ISNULL(GG.IsDeletedTransaction, 0) = 0;

    /* 2) Eligible jobs, one reason each */
    SELECT
        J.JobBookingID,
        J.JobBookingNo,
        R.Reason,
        J.OrderQty,
        ISNULL(G.GpnUnits, 0)                         AS GpnUnits,
        CAST(CASE WHEN J.OrderQty > 0
                  THEN ISNULL(G.GpnUnits, 0) * 100.0 / J.OrderQty END AS DECIMAL(9,2)) AS GpnPct,
        G.LastGPNDate,
        GG.LastGangGPNDate,
        A.LastAllocDate
    INTO #EligibleJobs
    FROM #Jobs AS J
    LEFT JOIN #GPN        AS G  ON G.JobBookingID  = J.JobBookingID
    LEFT JOIN #GangGPN    AS GG ON GG.JobBookingID = J.JobBookingID
    LEFT JOIN #Alloc      AS A  ON A.JobBookingID  = J.JobBookingID
    LEFT JOIN #OnSchedule AS S  ON S.JobBookingID  = J.JobBookingID
    CROSS APPLY (
        SELECT Reason =
            CASE
                WHEN J.OrderQty > 0
                 AND ISNULL(G.GpnUnits, 0) > J.OrderQty * @Threshold
                    THEN 'GPN_OVER_THRESHOLD'
                WHEN J.IsClosed = 1
                    THEN 'JOB_CLOSED'
                WHEN @ScheduleReady = 1
                 AND S.JobBookingID IS NULL
                 AND A.LastAllocDate < @StaleCutoff
                 AND (G.LastGPNDate      IS NULL OR G.LastGPNDate      < @StaleCutoff)
                 AND (GG.LastGangGPNDate IS NULL OR GG.LastGangGPNDate < @StaleCutoff)
                    THEN CASE WHEN ISNULL(G.GpnUnits, 0) = 0 THEN 'STALE_NO_GPN' ELSE 'STALE_GPN_IDLE' END
            END
    ) AS R
    WHERE R.Reason IS NOT NULL;

    /* 3) What changes: live picklist lines and still-open contents */
    SELECT
        JBC.JobBookingJobCardContentsID,
        JBC.JobBookingID,
        EJ.Reason,
        CAST(ISNULL(JBC.IsAllocationClosed, 0) AS BIT) AS IsAllocationClosed
    INTO #EligibleContents
    FROM dbo.JobBookingJobCardContents AS JBC
    JOIN #EligibleJobs AS EJ
      ON EJ.JobBookingID = JBC.JobBookingID
    WHERE ISNULL(JBC.IsDeletedTransaction, 0) = 0;

    SELECT
        ITD.TransactionDetailID,
        EC.JobBookingJobCardContentsID,
        EC.JobBookingID,
        EC.Reason
    INTO #PicklistLines
    FROM dbo.ItemTransactionMain  AS ITM
    JOIN dbo.ItemTransactionDetail AS ITD
      ON ITD.TransactionID = ITM.TransactionID
    JOIN #EligibleContents AS EC
      ON EC.JobBookingJobCardContentsID = ITD.JobBookingJobCardContentsID
    WHERE ITM.VoucherID = -17
      AND ISNULL(ITM.IsDeletedTransaction, 0) = 0
      AND ISNULL(ITD.IsDeletedTransaction, 0) = 0;

    /* 4) Report: only jobs with something left to change */
    SELECT
        EJ.JobBookingNo,
        EJ.JobBookingID,
        EJ.Reason,
        EJ.OrderQty,
        EJ.GpnUnits,
        EJ.GpnPct,
        EJ.LastGPNDate,
        EJ.LastGangGPNDate,
        EJ.LastAllocDate,
        DaysSinceAlloc   = DATEDIFF(DAY, EJ.LastAllocDate, @Today),
        PicklistLines    = ISNULL(PL.Lines, 0),
        ContentsToClose  = ISNULL(EC.OpenContents, 0)
    FROM #EligibleJobs AS EJ
    LEFT JOIN (SELECT JobBookingID, COUNT(*) AS Lines
               FROM #PicklistLines GROUP BY JobBookingID) AS PL
      ON PL.JobBookingID = EJ.JobBookingID
    LEFT JOIN (SELECT JobBookingID, COUNT(*) AS OpenContents
               FROM #EligibleContents WHERE IsAllocationClosed = 0 GROUP BY JobBookingID) AS EC
      ON EC.JobBookingID = EJ.JobBookingID
    WHERE ISNULL(PL.Lines, 0) > 0 OR ISNULL(EC.OpenContents, 0) > 0
    ORDER BY EJ.Reason, EJ.LastAllocDate, EJ.JobBookingNo;

    DECLARE @PicklistDeleted INT = 0,
            @ClosedAlloc     INT = 0;

    IF @DryRun = 0
    BEGIN
        BEGIN TRAN;

        /* 5) Soft-delete the picklist lines */
        UPDATE ITD
           SET ITD.IsDeletedTransaction = 1,
               ITD.DeletedBy            = 2,
               ITD.DeletedDate          = @AutoDeleteDate
        OUTPUT @RunID, @RunAt, PL.JobBookingID, PL.Reason, 'PICKLIST_DELETED',
               inserted.TransactionDetailID, PL.JobBookingJobCardContentsID,
               deleted.IsDeletedTransaction, deleted.DeletedBy, deleted.DeletedDate, NULL
          INTO dbo.PicklistAutoCloseLog
               (RunID, RunAt, JobBookingID, Reason, Action,
                TransactionDetailID, JobBookingJobCardContentsID,
                PrevIsDeletedTransaction, PrevDeletedBy, PrevDeletedDate, PrevIsAllocationClosed)
        FROM dbo.ItemTransactionDetail AS ITD
        JOIN #PicklistLines AS PL
          ON PL.TransactionDetailID = ITD.TransactionDetailID
        WHERE ISNULL(ITD.IsDeletedTransaction, 0) = 0;

        SET @PicklistDeleted = @@ROWCOUNT;

        /* 6) Close allocation so the contents leave pending allocation */
        UPDATE JBC
           SET JBC.IsAllocationClosed = 1
        OUTPUT @RunID, @RunAt, EC.JobBookingID, EC.Reason, 'ALLOCATION_CLOSED',
               NULL, inserted.JobBookingJobCardContentsID,
               NULL, NULL, NULL, deleted.IsAllocationClosed
          INTO dbo.PicklistAutoCloseLog
               (RunID, RunAt, JobBookingID, Reason, Action,
                TransactionDetailID, JobBookingJobCardContentsID,
                PrevIsDeletedTransaction, PrevDeletedBy, PrevDeletedDate, PrevIsAllocationClosed)
        FROM dbo.JobBookingJobCardContents AS JBC
        JOIN #EligibleContents AS EC
          ON EC.JobBookingJobCardContentsID = JBC.JobBookingJobCardContentsID
        WHERE ISNULL(JBC.IsAllocationClosed, 0) = 0
          AND ISNULL(JBC.IsDeletedTransaction, 0) = 0;

        SET @ClosedAlloc = @@ROWCOUNT;

        COMMIT TRAN;
    END
    ELSE
    BEGIN
        SET @PicklistDeleted = (SELECT COUNT(*) FROM #PicklistLines);
        SET @ClosedAlloc     = (SELECT COUNT(*) FROM #EligibleContents WHERE IsAllocationClosed = 0);
    END

    /* 7) Summary (in a dry run the two counts are what would change) */
    SELECT
        RunID                    = @RunID,
        RunMode                  = @RunMode,
        StaleRuleActive          = @ScheduleReady,
        EligibleJobs             = (SELECT COUNT(*) FROM #EligibleJobs),
        PicklistRowsSoftDeleted  = @PicklistDeleted,
        ContentsAllocationClosed = @ClosedAlloc,
        JobsChanged              = (SELECT COUNT(DISTINCT JobBookingID) FROM (
                                        SELECT JobBookingID FROM #PicklistLines
                                        UNION
                                        SELECT JobBookingID FROM #EligibleContents WHERE IsAllocationClosed = 0) X),
        Lines_GpnOverThreshold   = (SELECT COUNT(*) FROM #PicklistLines WHERE Reason = 'GPN_OVER_THRESHOLD'),
        Lines_JobClosed          = (SELECT COUNT(*) FROM #PicklistLines WHERE Reason = 'JOB_CLOSED'),
        Lines_StaleNoGpn         = (SELECT COUNT(*) FROM #PicklistLines WHERE Reason = 'STALE_NO_GPN'),
        Lines_StaleGpnIdle       = (SELECT COUNT(*) FROM #PicklistLines WHERE Reason = 'STALE_GPN_IDLE');
END
GO
