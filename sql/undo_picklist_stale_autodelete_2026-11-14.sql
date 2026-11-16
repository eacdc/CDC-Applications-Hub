/* Undo the stale-rule picklist deletes made by usp_AutoDeletePicklist_AndCloseAllocation_OnGPN_v2
   (runs from 14 Nov 2026 13:51 onwards), for jobs still on the machine schedule.
   Those runs soft-deleted pick lines (VoucherID -17) and closed allocation for jobs waiting to print,
   so the print plan showed Picked = 0. Every change is in dbo.PicklistAutoCloseLog with the previous values.
   - Only STALE_NO_GPN / STALE_GPN_IDLE rows. GPN_OVER_THRESHOLD and JOB_CLOSED (the v1 rules) are left alone.
   - Only contents currently in JobScheduleReleaseMachineWise.
   - A pick line is restored only if it is still exactly as v2 left it (deleted by 2, 19xx date) and its
     voucher is not deleted. A content that was re-picked after the run is skipped.
   - The undo is written to PicklistAutoCloseLog (Reason UNDO_STALE_RULE) so it can itself be traced.
   Install the fixed v2 (usp_AutoDeletePicklist_AndCloseAllocation_OnGPN_v2.sql) FIRST, or the next nightly
   run deletes these picks again.
   Run on the Kolkata IndusEnterprise database. Step 1 is a preview only; step 2 writes. */

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_DEFINITION(OBJECT_ID('dbo.usp_AutoDeletePicklist_AndCloseAllocation_OnGPN_v2')) NOT LIKE '%#OnSchedule%'
BEGIN
    RAISERROR('Install the fixed usp_AutoDeletePicklist_AndCloseAllocation_OnGPN_v2 first.', 16, 1);
    RETURN;
END

DECLARE @UndoRunID UNIQUEIDENTIFIER = NEWID();
DECLARE @UndoAt    DATETIME         = GETDATE();

IF OBJECT_ID('tempdb..#OnSchedule') IS NOT NULL DROP TABLE #OnSchedule;
SELECT DISTINCT MW.JobBookingJobcardContentsID AS ContentsID
INTO #OnSchedule
FROM dbo.JobScheduleReleaseMachineWise AS MW;

-- contents picked again after the first v2 run: leave them as they are
IF OBJECT_ID('tempdb..#RePicked') IS NOT NULL DROP TABLE #RePicked;
SELECT DISTINCT ITD.JobBookingJobCardContentsID AS ContentsID
INTO #RePicked
FROM dbo.ItemTransactionDetail AS ITD
JOIN dbo.ItemTransactionMain   AS ITM
  ON ITM.TransactionID = ITD.TransactionID
 AND ITM.VoucherID = -17
 AND ISNULL(ITM.IsDeletedTransaction, 0) = 0
WHERE ISNULL(ITD.IsDeletedTransaction, 0) = 0
  AND ITM.CreatedDate >= '20261114 13:51:00'
  AND ITD.JobBookingJobCardContentsID IN (SELECT ContentsID FROM #OnSchedule);

IF OBJECT_ID('tempdb..#Lines') IS NOT NULL DROP TABLE #Lines;
SELECT L.LogID, L.JobBookingID, L.TransactionDetailID, L.JobBookingJobCardContentsID,
       L.PrevIsDeletedTransaction, L.PrevDeletedBy, L.PrevDeletedDate
INTO #Lines
FROM dbo.PicklistAutoCloseLog AS L
JOIN dbo.ItemTransactionDetail AS ITD ON ITD.TransactionDetailID = L.TransactionDetailID
JOIN dbo.ItemTransactionMain   AS ITM ON ITM.TransactionID = ITD.TransactionID
WHERE L.Action = 'PICKLIST_DELETED'
  AND L.Reason IN ('STALE_NO_GPN', 'STALE_GPN_IDLE')
  AND L.JobBookingJobCardContentsID IN (SELECT ContentsID FROM #OnSchedule)
  AND L.JobBookingJobCardContentsID NOT IN (SELECT ContentsID FROM #RePicked)
  AND ITD.IsDeletedTransaction = 1
  AND ITD.DeletedBy = 2
  AND ITD.DeletedDate < '20000101'
  AND ISNULL(ITM.IsDeletedTransaction, 0) = 0;

IF OBJECT_ID('tempdb..#Allocs') IS NOT NULL DROP TABLE #Allocs;
SELECT L.LogID, L.JobBookingID, L.JobBookingJobCardContentsID, L.PrevIsAllocationClosed
INTO #Allocs
FROM dbo.PicklistAutoCloseLog AS L
JOIN dbo.JobBookingJobCardContents AS JBC ON JBC.JobBookingJobCardContentsID = L.JobBookingJobCardContentsID
WHERE L.Action = 'ALLOCATION_CLOSED'
  AND L.Reason IN ('STALE_NO_GPN', 'STALE_GPN_IDLE')
  AND L.JobBookingJobCardContentsID IN (SELECT ContentsID FROM #OnSchedule)
  AND JBC.IsAllocationClosed = 1
  AND ISNULL(L.PrevIsAllocationClosed, 0) = 0;

-- 1) Preview: one row per content, with the machine(s) it is on and the kg that comes back as Picked
SELECT
    JBC.JobCardContentNo,
    Machines        = (SELECT STRING_AGG(MM.MachineName, ', ')
                       FROM (SELECT DISTINCT MW.MachineID FROM dbo.JobScheduleReleaseMachineWise AS MW
                             WHERE MW.JobBookingJobcardContentsID = JBC.JobBookingJobCardContentsID) AS M
                       JOIN dbo.MachineMaster AS MM ON MM.MachineID = M.MachineID),
    PickLines       = COUNT(DISTINCT LN.TransactionDetailID),
    PickedKgBack    = ROUND(SUM(CASE WHEN UPPER(IM.StockUnit) = 'KG' THEN ISNULL(ITD.RequiredQuantity, 0)
                                     ELSE ISNULL(ITD.RequiredQuantity, 0) * IM.SizeL * IM.SizeW * IM.GSM / 1000000000.0 END), 2),
    ReopenAlloc     = MAX(CASE WHEN AL.JobBookingJobCardContentsID IS NOT NULL THEN 1 ELSE 0 END)
FROM dbo.JobBookingJobCardContents AS JBC
LEFT JOIN #Lines AS LN ON LN.JobBookingJobCardContentsID = JBC.JobBookingJobCardContentsID
LEFT JOIN dbo.ItemTransactionDetail AS ITD ON ITD.TransactionDetailID = LN.TransactionDetailID
LEFT JOIN dbo.ItemMaster AS IM ON IM.ItemID = ITD.ItemID
LEFT JOIN (SELECT DISTINCT JobBookingJobCardContentsID FROM #Allocs) AS AL
  ON AL.JobBookingJobCardContentsID = JBC.JobBookingJobCardContentsID
WHERE JBC.JobBookingJobCardContentsID IN (SELECT JobBookingJobCardContentsID FROM #Lines
                                          UNION SELECT JobBookingJobCardContentsID FROM #Allocs)
GROUP BY JBC.JobBookingJobCardContentsID, JBC.JobCardContentNo
ORDER BY Machines, JBC.JobCardContentNo;

SELECT LinesToRestore    = (SELECT COUNT(*) FROM #Lines),
       AllocsToReopen    = (SELECT COUNT(*) FROM #Allocs),
       SkippedRePicked   = (SELECT COUNT(*) FROM #RePicked);

-- 2) Apply (uncomment to run)
-- BEGIN TRAN;
--
-- UPDATE ITD
--    SET ITD.IsDeletedTransaction = LN.PrevIsDeletedTransaction,
--        ITD.DeletedBy            = LN.PrevDeletedBy,
--        ITD.DeletedDate          = LN.PrevDeletedDate
-- OUTPUT @UndoRunID, @UndoAt, LN.JobBookingID, 'UNDO_STALE_RULE', 'PICKLIST_RESTORED',
--        inserted.TransactionDetailID, LN.JobBookingJobCardContentsID,
--        deleted.IsDeletedTransaction, deleted.DeletedBy, deleted.DeletedDate, NULL
--   INTO dbo.PicklistAutoCloseLog
--        (RunID, RunAt, JobBookingID, Reason, Action,
--         TransactionDetailID, JobBookingJobCardContentsID,
--         PrevIsDeletedTransaction, PrevDeletedBy, PrevDeletedDate, PrevIsAllocationClosed)
-- FROM dbo.ItemTransactionDetail AS ITD
-- JOIN #Lines AS LN ON LN.TransactionDetailID = ITD.TransactionDetailID;
--
-- UPDATE JBC
--    SET JBC.IsAllocationClosed = AL.PrevIsAllocationClosed
-- OUTPUT @UndoRunID, @UndoAt, AL.JobBookingID, 'UNDO_STALE_RULE', 'ALLOCATION_REOPENED',
--        NULL, inserted.JobBookingJobCardContentsID,
--        NULL, NULL, NULL, deleted.IsAllocationClosed
--   INTO dbo.PicklistAutoCloseLog
--        (RunID, RunAt, JobBookingID, Reason, Action,
--         TransactionDetailID, JobBookingJobCardContentsID,
--         PrevIsDeletedTransaction, PrevDeletedBy, PrevDeletedDate, PrevIsAllocationClosed)
-- FROM dbo.JobBookingJobCardContents AS JBC
-- JOIN #Allocs AS AL ON AL.JobBookingJobCardContentsID = JBC.JobBookingJobCardContentsID;
--
-- COMMIT TRAN;
