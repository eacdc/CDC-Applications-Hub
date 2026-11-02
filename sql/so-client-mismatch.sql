/* ============================================================================
   Sales Order booked against the WRONG client
   Investigation: RSH Global Private Limited - Baddi (6350) vs
                  Dollar Industries Limited (Delhi) (6385)
   DB: IndusEnterprise (Kolkata), CompanyID = 2
   Date: 2026-10-27
   ----------------------------------------------------------------------------
   The ERP does not validate that JobOrderBooking(.Details).LedgerID matches
   ProductMaster.LedgerID of the products on the order, so a stale client in
   the entry form saves silently. These queries detect it; section 3 fixes the
   one live case found.
   Run in SSMS. Nothing here is executed by any tool.
   ============================================================================ */


/* ---------------------------------------------------------------------------
   1. DETECTOR - every sales order whose client differs from the client that
      owns the products on it. Run this daily / before job-card creation.
   --------------------------------------------------------------------------- */
SELECT  H.OrderBookingID,
        H.SalesOrderNo,
        H.OrderBookingDate,
        SO_Client   = LS.LedgerName,
        SO_LedgerID = D.LedgerID,
        Product_Client   = LP.LedgerName,
        Product_LedgerID = P.LedgerID,
        D.JobName,
        D.ProductMasterCode,
        D.ProductCode,
        H.PONo,
        SalesEmployee = LE.LedgerName,
        EnteredBy     = UM.UserName,
        JobCardMade   = CASE WHEN J.JobBookingID IS NOT NULL THEN 'YES' ELSE 'no' END,
        J.JobBookingNo
FROM        JobOrderBookingDetails D
JOIN        JobOrderBooking   H  ON H.OrderBookingID = D.OrderBookingID
                                AND H.CompanyID      = D.CompanyID
JOIN        ProductMaster     P  ON P.ProductMasterID = D.ProductMasterID
                                AND P.CompanyID       = D.CompanyID
LEFT JOIN   LedgerMaster      LS ON LS.LedgerID = D.LedgerID AND LS.CompanyID = D.CompanyID
LEFT JOIN   LedgerMaster      LP ON LP.LedgerID = P.LedgerID AND LP.CompanyID = P.CompanyID
LEFT JOIN   LedgerMaster      LE ON LE.LedgerID = H.SalesEmployeeID AND LE.CompanyID = H.CompanyID
LEFT JOIN   UserMaster        UM ON UM.UserID   = D.UserID
LEFT JOIN   JobBookingJobCard J  ON J.OrderBookingID        = D.OrderBookingID
                                AND J.OrderBookingDetailsID = D.OrderBookingDetailsID
                                AND J.CompanyID             = D.CompanyID
                                AND ISNULL(J.IsDeletedTransaction,0) = 0
WHERE   D.CompanyID = 2
    AND ISNULL(D.IsDeletedTransaction,0) = 0
    AND ISNULL(H.IsDeletedTransaction,0) = 0
    AND ISNULL(P.IsDeletedTransaction,0) = 0
    AND ISNULL(D.ProductMasterID,0) > 0
    AND ISNULL(P.LedgerID,0)        > 0
    AND D.LedgerID <> P.LedgerID
ORDER BY H.OrderBookingID DESC;
/* As of 2026-10-27: 99 lines across 50 orders; 83 of those lines already have
   a job card, i.e. the wrong client has already reached production.         */


/* ---------------------------------------------------------------------------
   2. SECOND, INDEPENDENT DETECTOR - PO-number fingerprint.
      Catches a swap even when the products were re-picked under the wrong
      client. RSH Baddi POs are BD*/PO-BD*/PGR*; Dollar Delhi POs are 9-digit.
   --------------------------------------------------------------------------- */
SELECT  H.OrderBookingID, H.SalesOrderNo, H.OrderBookingDate,
        Client = L.LedgerName, H.LedgerID, H.PONo,
        SalesEmployee = LE.LedgerName,
        Deleted = CAST(ISNULL(H.IsDeletedTransaction,0) AS int)
FROM        JobOrderBooking H
LEFT JOIN   LedgerMaster L  ON L.LedgerID  = H.LedgerID        AND L.CompanyID  = H.CompanyID
LEFT JOIN   LedgerMaster LE ON LE.LedgerID = H.SalesEmployeeID AND LE.CompanyID = H.CompanyID
WHERE   H.CompanyID = 2
    AND (   (H.LedgerID = 6385 AND (H.PONo LIKE 'BD%' OR H.PONo LIKE 'PO-BD%' OR H.PONo LIKE 'PGR%'))
         OR (H.LedgerID = 6350 AND H.PONo LIKE '1[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]')
         OR (H.LedgerID NOT IN (6350,6385)
             AND (H.PONo LIKE 'PO-BD5%' OR H.PONo LIKE 'BD[12]2[0-9]-PO-%')) )
ORDER BY H.OrderBookingID;


/* ---------------------------------------------------------------------------
   3. CORRECTION: SL05503_26_27 (OrderBookingID 14204) -> Dollar Delhi (6385)

      Booked under 6350 RSH Global Private Limited - Baddi, but every line is a
      Dollar Delhi product, PO 103260133 is Dollar's, and SalesEmployeeID 6386
      (Sameer Arora) is Dollar's. It is the second half of that Dollar PO; the
      first 14 lines are correct on SL05502_26_27 (OrderBookingID 14203).

      WHICH TABLES NEED CHANGING - all 28 tables carrying OrderBookingID were
      counted for 14204. Only three hold rows:
        JobOrderBooking                 1 row   -> LedgerID, fix below
        JobOrderBookingDetails         16 rows  -> LedgerID, fix below
        ArtworkProcessApproval         16 rows  -> NO client column (keys on
                                                   OrderBookingID /
                                                   OrderBookingDetailsID /
                                                   JobBookingID only), so it
                                                   follows the order
                                                   automatically. Nothing to do.
      All zero: ArtworkMasterMain, ArtworkProcessApprovalDetail,
        BusinessVerticalDetails, CommentChainMaster,
        CreditDaysApprovalTransactionsDetail,
        CreditLimitApprovalTransactionsDetail, DispatchSchedule,
        FinishGoodsTransactionDetail/Main/SemiPacking, InvoiceTransactionDetail,
        JobBookingJobCard, JobBookingJobCardContents, JobBookingJobCardGang,
        JobBookingJobCardKitDetails, JobBookingJobCardManual,
        JobOrderBookingBatchDetails, JobOrderBookingDeliveryDetails,
        JobOrderBookingGang, JobOrderBookingOneTimeCharges,
        JobSemiPackingDetail/Main, ProductTransactionDetail,
        PWOCommonBookPagesMakingDetails, ResortingTransactionMain.
      Nothing is in production, so re-pointing the client is safe.

      LEDGERID IS THE ONLY WRONG FIELD. Diffed against the correct Dollar twin
      14203: SalesType (Regular B2B), SalesLedgerID (6352), ConsigneeID (0),
      SalesEmployeeID (6386), ContactPersonID (0), JobCoordinatorID (0),
      TransporterID (0), CurrencyCode, BookingPrefix and BranchID are all
      already identical. Do not change any of them.

      Prefer changing the client in the ERP sales-order screen if it lets you.
      Use this script only if the screen will not allow the edit.
   --------------------------------------------------------------------------- */

-- 3a. Before: confirm what you are about to change (expect 1 header + 16 detail,
--     all showing LedgerID 6350)
SELECT 'HEADER' AS Part, OrderBookingID, SalesOrderNo, LedgerID, SalesEmployeeID, PONo
FROM   JobOrderBooking
WHERE  CompanyID = 2 AND OrderBookingID = 14204
UNION ALL
SELECT 'DETAIL', OrderBookingID, SalesOrderNo, LedgerID, NULL, PONo
FROM   JobOrderBookingDetails
WHERE  CompanyID = 2 AND OrderBookingID = 14204 AND ISNULL(IsDeletedTransaction,0) = 0;

-- 3b. The fix. Guarded on the current wrong value, so a second run is a no-op.
BEGIN TRANSACTION;

    DECLARE @hdr int, @dtl int;

    UPDATE  JobOrderBooking
    SET     LedgerID = 6385                 -- Dollar Industries Limited (Delhi)
    WHERE   CompanyID      = 2
        AND OrderBookingID = 14204
        AND LedgerID       = 6350;          -- guard: only if still RSH Baddi

    SET @hdr = @@ROWCOUNT;

    UPDATE  JobOrderBookingDetails
    SET     LedgerID = 6385
    WHERE   CompanyID      = 2
        AND OrderBookingID = 14204
        AND LedgerID       = 6350;

    SET @dtl = @@ROWCOUNT;

    PRINT 'header rows updated: ' + CAST(@hdr AS varchar(10)) + ' (expect 1)';
    PRINT 'detail rows updated: ' + CAST(@dtl AS varchar(10)) + ' (expect 16)';

    IF @hdr = 1 AND @dtl = 16
    BEGIN
        COMMIT TRANSACTION;
        PRINT 'COMMITTED - SL05503_26_27 now belongs to Dollar Industries Limited (Delhi).';
    END
    ELSE
    BEGIN
        ROLLBACK TRANSACTION;
        PRINT 'ROLLED BACK - unexpected row counts, nothing changed. Re-run 3a and investigate.';
    END

-- 3c. After: both of these should confirm the fix
SELECT 'HEADER' AS Part, OrderBookingID, SalesOrderNo, LedgerID   -- expect 6385
FROM   JobOrderBooking
WHERE  CompanyID = 2 AND OrderBookingID = 14204
UNION ALL
SELECT 'DETAIL', OrderBookingID, SalesOrderNo, LedgerID           -- expect 6385 x16
FROM   JobOrderBookingDetails
WHERE  CompanyID = 2 AND OrderBookingID = 14204 AND ISNULL(IsDeletedTransaction,0) = 0;

-- ...and the section-1 detector should no longer return OrderBookingID 14204.
