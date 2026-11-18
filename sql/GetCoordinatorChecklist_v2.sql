/*
  GetCoordinatorChecklist_v2
  ---------------------------------------------------------------------------
  Same output as GetCoordinatorChecklist (used by GET /api/google-sheet/process),
  with one change:

    Sale-order lines whose job card was DELETED (and that have no other active
    job card) are now excluded. Previously they came through with a blank
    JobCard Number and blank PrepressPerson, e.g. SL06183_26_27 / SL06184_26_27
    (jobs J08935 / J08936 deleted and re-booked as SL06192 / SL06193).

    Lines that never had a job card are still included (job card pending).

  Deploy: run this whole script once in IndusEnterprise (Kolkata) and once in
  IndusEnterprise2 (Ahmedabad). The original GetCoordinatorChecklist is untouched.
*/

CREATE OR ALTER PROCEDURE [dbo].[GetCoordinatorChecklist_v2]
    @FromDate DATE = NULL,   -- filter by Sales Order Date (inclusive)
    @ToDate   DATE = NULL    -- filter by Sales Order Date (inclusive)
AS
BEGIN
    SET NOCOUNT ON;

    ;WITH base AS (
        SELECT
            -- Sale Order context
            JOBD.OrderBookingID,
            JOBD.OrderBookingDetailsID,
            LM.LedgerName                   AS ClientName,
            JOB.PONo                        AS ClientPONo,        -- Client PO number
            JOB.PODate                      AS ClientPODate,      -- Client PO date
            JOB.SalesOrderNo                AS SalesOrderNo,      -- adjust if different
            JOB.OrderBookingDate            AS SalesOrderDate,    -- Sales Order Date (filter applied here)

            -- NEW: Sales & Coordinator IDs
            JOB.SalesEmployeeID,
            JOB.UserID                      AS CoordinatorUserID,

            -- Division via Category → Segment
            CM.SegmentID,
            SM.SegmentName                  AS Division,          -- Commercial | Packaging (from SegmentMaster)

            -- Optional Job Card (may be NULL)
            JEJ.JobBookingID,
            JEJ.JobBookingNo                AS JobCardNo,
            JEJ.JobBookingDate              AS JobCardDate
        FROM LedgerMaster                 AS LM
        INNER JOIN JobOrderBooking        AS JOB  ON JOB.LedgerID = LM.LedgerID
        INNER JOIN JobOrderBookingDetails AS JOBD ON JOBD.OrderBookingID = JOB.OrderBookingID

        -- Division mapping
        LEFT  JOIN CategoryMaster         AS CM   ON CM.CategoryID = JOBD.CategoryID
        LEFT  JOIN SegmentMaster          AS SM   ON SM.SegmentID  = CM.SegmentID

        -- Job Card is optional
        LEFT  JOIN JobBookingJobCard      AS JEJ
               ON JEJ.OrderBookingID        = JOBD.OrderBookingID
              AND JEJ.OrderBookingDetailsID = JOBD.OrderBookingDetailsID
              AND ISNULL(JEJ.IsCancel,0) = 0
              AND ISNULL(JEJ.IsDeletedTransaction,0) = 0
        WHERE
             ISNULL(JOB.IsDeletedTransaction,0) = 0 AND
             ISNULL(JOBD.IsDeletedTransaction,0) = 0 AND
             ISNULL(JEJ.IsClose,0)  = 0 AND
            (@FromDate IS NULL OR CAST(JOB.OrderBookingDate AS date) >= @FromDate) AND
            (@ToDate   IS NULL OR CAST(JOB.OrderBookingDate AS date) <= @ToDate) AND

            -- v2: drop lines whose job card was deleted and nothing active replaced it
            NOT (
                JEJ.JobBookingID IS NULL
                AND EXISTS (
                    SELECT 1
                    FROM JobBookingJobCard AS JD
                    WHERE JD.OrderBookingID        = JOBD.OrderBookingID
                      AND JD.OrderBookingDetailsID = JOBD.OrderBookingDetailsID
                      AND ISNULL(JD.IsDeletedTransaction,0) = 1
                )
            )
    ),

    -- Latest Artwork / Prepress per order line (even if no Job Card yet)
    ap_latest AS (
        SELECT
            b.OrderBookingDetailsID,
            ap.FinallyApproved,
            ap.EmployeeID,
            ap.FileName,
            ap.FileReceivedDate
        FROM base b
        OUTER APPLY (
            SELECT TOP (1)
                   ap2.FinallyApproved,
                   ap2.EmployeeID,
                   ap2.ArtworkProcessApprovalID,
                   ap2.[FileName],
                   ap2.FileReceivedDate
            FROM ArtworkProcessApproval ap2
            WHERE ap2.OrderBookingDetailsID = b.OrderBookingDetailsID
            ORDER BY ap2.ArtworkProcessApprovalID DESC
        ) ap
    ),

    -- Paper Allocation across ALL components of the Job Card (if one exists)
    alloc AS (
        SELECT
            JEJ.JobBookingID,
            SUM(ISNULL(ITD.RequiredQuantity,0)) AS AllocQty,
            MIN(ITM.VoucherDate)                AS FirstAllocDate
        FROM JobBookingJobCard               AS JEJ
        INNER JOIN JobBookingJobCardContents AS JEJC
            ON JEJC.JobBookingID = JEJ.JobBookingID
        INNER JOIN ItemTransactionDetail     AS ITD
            ON ITD.JobBookingJobCardContentsID = JEJC.JobBookingJobCardContentsID
        INNER JOIN ItemTransactionMain       AS ITM
            ON ITM.TransactionID = ITD.TransactionID
           AND ITM.VoucherID = -17                                -- Allocation voucher
           AND ISNULL(ITM.IsDeleted,0) = 0
           AND ISNULL(ITM.IsDeletedTransaction,0) = 0
        WHERE ISNULL(ITD.IsDeletedTransaction,0) = 0
        GROUP BY JEJ.JobBookingID
    ),

    -- ‘Removed from Allocation’ when content is marked IsAllocationClosed = 1
    closed_alloc AS (
        SELECT
            JEJ.JobBookingID,
            -- Use the earliest content CreatedDate where allocation was closed, plus 12 hours
            MIN(DATEADD(HOUR, 12, JEJC.CreatedDate)) AS RemovedAllocDate
        FROM JobBookingJobCard JEJ
        INNER JOIN JobBookingJobCardContents JEJC
            ON JEJC.JobBookingID = JEJ.JobBookingID
        WHERE
              ISNULL(JEJ.IsCancel,0) = 0
          AND ISNULL(JEJ.IsClose,0)  = 0
          AND ISNULL(JEJ.IsDeletedTransaction,0) = 0
          AND ISNULL(JEJC.IsDeletedTransaction,0) = 0
          AND ISNULL(JEJC.IsAllocationClosed,0) = 1
        GROUP BY JEJ.JobBookingID
    ),

    /* NEW: Aggregate DispatchSchedule to derive initial communication status/datetime.
       Treat '1900-01-01' placeholders as NULL. If both channels exist, pick the EARLIEST. */
    ds_norm AS (
        SELECT
            ds.OrderBookingDetailsID,
            CASE WHEN ds.DelEmailDate    > '1900-01-01' THEN ds.DelEmailDate    END AS EmailDT,
            CASE WHEN ds.DelWhatsappDate > '1900-01-01' THEN ds.DelWhatsappDate END AS WhatsAppDT
        FROM dbo.DispatchSchedule ds
    ),
    ds_agg AS (
        SELECT
            OrderBookingDetailsID,
            MIN(EmailDT)    AS FirstEmailDT,
            MIN(WhatsAppDT) AS FirstWhatsappDT
        FROM ds_norm
        GROUP BY OrderBookingDetailsID
    ),
    ds_pick AS (
        SELECT
            da.OrderBookingDetailsID,
            CASE
                WHEN COALESCE(da.FirstEmailDT, da.FirstWhatsappDT) IS NOT NULL THEN 1
                ELSE 0
            END AS InitCommYes,
            CASE
                WHEN da.FirstEmailDT IS NULL AND da.FirstWhatsappDT IS NULL THEN NULL
                WHEN da.FirstEmailDT IS NULL THEN da.FirstWhatsappDT
                WHEN da.FirstWhatsappDT IS NULL THEN da.FirstEmailDT
                ELSE CASE WHEN da.FirstEmailDT <= da.FirstWhatsappDT THEN da.FirstEmailDT ELSE da.FirstWhatsappDT END
            END AS InitCommDT
        FROM ds_agg da
    )

    SELECT
        b.ClientName                                        AS [Client Name],
        b.ClientPONo                                        AS [PO number],
        CONVERT(date, b.ClientPODate)                       AS [PO Date],
        b.SalesOrderNo                                      AS [Sale order number],
        CONVERT(date, b.SalesOrderDate)                     AS [Sale order Date],
        b.JobCardNo                                         AS [JobCard Number],
        CONVERT(date, b.JobCardDate)                        AS [Jobcard Date],

        -- Division from SegmentMaster
        b.Division                                          AS [Division],

        -- File status from latest artwork record on that order line
        CASE
            WHEN ap.FinallyApproved IS NULL THEN NULL
            WHEN TRY_CAST(ap.FinallyApproved AS int) = 1 THEN 'Approved'
            WHEN TRY_CAST(ap.FinallyApproved AS bit) = 1 THEN 'Approved'
            WHEN UPPER(CONVERT(varchar(32), ap.FinallyApproved)) IN ('YES','APPROVED','TRUE') THEN 'Approved'
            ELSE 'Pending'
        END                                                 AS [File status],

        -- Prepress Person Allocated (EmployeeID → LedgerMaster.LedgerName)
        LM_Emp.LedgerName                                   AS [PrepressPerson Allocated],

        -- NEW: Sales & Coordinator
        b.SalesEmployeeID                                   AS [SalesEmployeeID],
        LM_Sales.LedgerName                                 AS [Sales Name],
        b.CoordinatorUserID                                 AS [CoordinatorUserID],
        UM.UserName                                         AS [Coordinator Name],

        -- Paper allocation status/date with ‘Removed from Allocation’ override
        CASE
             WHEN ca.JobBookingID IS NOT NULL THEN 'Removed from Allocation'
             WHEN ISNULL(a.AllocQty,0) > 0 THEN 'Allocated'
             WHEN b.JobBookingID IS NULL THEN NULL
             ELSE 'Not Allocated'
        END                                                 AS [Paper Allocation Status],

        CASE
             WHEN ca.JobBookingID IS NOT NULL THEN ca.RemovedAllocDate
             ELSE a.FirstAllocDate
        END                                                 AS [Paper Allocation Date],

        ap.[FileName],
        ap.FileReceivedDate,

        -- NEW: Initial communication fields from DispatchSchedule
        CASE WHEN dp.InitCommYes = 1 THEN 'Yes' ELSE 'No' END  AS [Initial Communication Sent],
        dp.InitCommDT                                          AS [Initial Communication DateTime]

    FROM base b
    LEFT JOIN ap_latest ap
      ON ap.OrderBookingDetailsID = b.OrderBookingDetailsID
    LEFT JOIN LedgerMaster AS LM_Emp
      ON LM_Emp.LedgerID = ap.EmployeeID                    -- Prepress person name
    LEFT JOIN LedgerMaster AS LM_Sales
      ON LM_Sales.LedgerID = b.SalesEmployeeID              -- Sales person name
    LEFT JOIN dbo.UserMaster AS UM
      ON UM.UserID = b.CoordinatorUserID                    -- Coordinator name
    LEFT JOIN alloc a
      ON a.JobBookingID = b.JobBookingID
    LEFT JOIN closed_alloc ca
      ON ca.JobBookingID = b.JobBookingID
    LEFT JOIN ds_pick dp
      ON dp.OrderBookingDetailsID = b.OrderBookingDetailsID

    -- Sort by PO Date (ascending), then PO No, then Sales Order No
    ORDER BY CONVERT(date, b.ClientPODate), b.ClientPONo, b.SalesOrderNo;
END
GO
