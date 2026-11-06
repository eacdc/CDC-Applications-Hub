/*=================================================================================
  dbo.GetPendingPOWithValue_v2
  ---------------------------------------------------------------------------------
  Same parameters, columns and business rules as dbo.GetPendingPOWithValue.

  Only change: the PO lines, GRN totals and latest rates are worked out once into
  temp tables before the final SELECT. The original kept GRNs and rates in CTEs,
  and the 30-day range took 30-40s against about 2s for 90 days.

  Deploy to BOTH databases: run once on IndusEnterprise, once on IndusEnterprise2.
=================================================================================*/
CREATE OR ALTER PROCEDURE [dbo].[GetPendingPOWithValue_v2]
    @CompanyID      INT           = 2,
    @FromDate       DATE          = NULL,   -- PO date range
    @ToDate         DATE          = NULL,
    @SupplierID     INT           = NULL,
    @ItemGroupID    INT           = NULL,
    @JobBookingNo   NVARCHAR(50)  = NULL,
    @IncludeKraft   BIT           = 0,
    @ReceiptCutoff  DECIMAL(5,2)  = 0.90,   -- exclude lines already >= 90% received
    @TopN           INT           = 5000
AS
BEGIN
    SET NOCOUNT ON;

    IF @FromDate IS NOT NULL AND @ToDate IS NOT NULL AND @ToDate < @FromDate
    BEGIN
        RAISERROR('ToDate must be >= FromDate.', 16, 1);
        RETURN;
    END

    /* Open PO lines in scope */
    SELECT
        ITD_PO.TransactionDetailID,
        ITD_PO.TransactionID,
        ITD_PO.ItemID
    INTO #POLines
    FROM dbo.ItemTransactionMain   ITM_PO WITH (NOLOCK)
    JOIN dbo.ItemTransactionDetail ITD_PO WITH (NOLOCK)
         ON ITD_PO.TransactionID = ITM_PO.TransactionID
    WHERE ITM_PO.VoucherID                          = -11          -- Purchase Orders only
      AND ISNULL(ITM_PO.IsDeletedTransaction, 0)    = 0
      AND ISNULL(ITD_PO.IsDeletedTransaction, 0)    = 0
      AND ISNULL(ITD_PO.IsCancelled, 0)             = 0
      AND ISNULL(ITD_PO.IsCompleted, 0)             = 0
      AND (@FromDate   IS NULL OR ITM_PO.VoucherDate >= @FromDate)
      AND (@ToDate     IS NULL OR ITM_PO.VoucherDate <  DATEADD(DAY, 1, @ToDate))
      AND (@SupplierID IS NULL OR ITM_PO.LedgerID    =  @SupplierID)
    OPTION (RECOMPILE);

    CREATE UNIQUE CLUSTERED INDEX CX_POLines ON #POLines (TransactionDetailID);

    /* GRN totals for those PO lines */
    SELECT
        d.PurchaseTransactionID,
        d.ItemID,
        SUM(ISNULL(d.ReceiptQuantity, 0))                       AS ReceivedQty_StockUnit,
        SUM(
            CASE
                /* already weight-based */
                WHEN UPPER(LTRIM(RTRIM(im.StockUnit))) IN ('KG','KGS','KGS.')
                    THEN ISNULL(d.ReceiptQuantity, 0)
                /* sheets -> KG from dimensions (primary rule) */
                WHEN UPPER(LTRIM(RTRIM(im.StockUnit))) IN ('SHEET','SHEETS')
                     AND ISNULL(im.GSM, 0)   > 0
                     AND ISNULL(im.SizeW, 0) > 0
                     AND ISNULL(im.SizeL, 0) > 0
                    THEN ISNULL(d.ReceiptQuantity, 0)
                         * im.SizeL * im.SizeW * im.GSM / 1000000000.0
                /* anything else: fall back to the challan weight */
                WHEN ISNULL(d.ChallanWeight, 0) > 0
                    THEN ISNULL(d.ChallanWeight, 0)
                ELSE ISNULL(d.ReceiptQuantity, 0)
            END
        )                                                       AS ReceivedQty_KG
    INTO #GRNAgg
    FROM dbo.ItemTransactionDetail d WITH (NOLOCK)
    JOIN dbo.ItemTransactionMain   m WITH (NOLOCK)
         ON m.TransactionID = d.TransactionID
    JOIN dbo.ItemMaster           im WITH (NOLOCK)
         ON im.ItemID = d.ItemID
    WHERE m.VoucherID = -14                                    -- GRN
      AND ISNULL(m.IsDeletedTransaction, 0) = 0
      AND ISNULL(d.IsDeletedTransaction, 0) = 0
      AND ISNULL(d.IsCancelled, 0)          = 0
      AND EXISTS (SELECT 1 FROM #POLines pl
                  WHERE pl.TransactionID = d.PurchaseTransactionID
                    AND pl.ItemID        = d.ItemID)
    GROUP BY d.PurchaseTransactionID, d.ItemID
    OPTION (RECOMPILE);

    CREATE UNIQUE CLUSTERED INDEX CX_GRNAgg ON #GRNAgg (PurchaseTransactionID, ItemID);

    /* Latest purchase rate per item, from approved PO lines (VoucherID -11) */
    SELECT ItemID, PurchaseRate
    INTO #LatestRate
    FROM (
        SELECT
            d.ItemID,
            d.PurchaseRate,
            ROW_NUMBER() OVER (PARTITION BY d.ItemID
                               ORDER BY m.VoucherDate DESC, d.TransactionID DESC) AS rn
        FROM dbo.ItemTransactionDetail d WITH (NOLOCK)
        JOIN dbo.ItemTransactionMain   m WITH (NOLOCK)
             ON m.TransactionID = d.TransactionID
        WHERE m.VoucherID = -11
          AND ISNULL(m.IsDeletedTransaction, 0) = 0
          AND ISNULL(d.IsDeletedTransaction, 0) = 0
          AND ISNULL(d.PurchaseRate, 0) > 0
          AND d.ItemID IN (SELECT ItemID FROM #POLines)
    ) x
    WHERE rn = 1
    OPTION (RECOMPILE);

    CREATE UNIQUE CLUSTERED INDEX CX_LatestRate ON #LatestRate (ItemID);

    SELECT TOP (@TopN)
        ITD_PO.TransactionDetailID                      AS PODetailID,   -- row key
        ITM_PO.VoucherNo                                AS PONumber,
        ITM_PO.VoucherDate                              AS PODate,
        ITD_PO.ExpectedDeliveryDate,
        CASE WHEN ITD_PO.ExpectedDeliveryDate IS NULL THEN NULL
             ELSE DATEDIFF(DAY, ITD_PO.ExpectedDeliveryDate, CAST(GETDATE() AS DATE))
        END                                             AS DaysOverdue,
        LM.LedgerName                                   AS Supplier,

        IM.ItemCode,
        IM.ItemName,
        IM.Quality,
        IM.GSM,
        CASE WHEN ISNULL(IM.SizeW,0) > 0 AND ISNULL(IM.SizeL,0) > 0
             THEN CAST(CAST(IM.SizeW AS INT) AS VARCHAR(10)) + ' x '
                + CAST(CAST(IM.SizeL AS INT) AS VARCHAR(10))
             ELSE NULL
        END                                             AS Size,
        IGM.ItemGroupName,
        IM.StockUnit,

        ROUND(q.POQty,          3)                      AS POQty,
        ROUND(rq.RecdQty,       3)                      AS ReceivedQty,
        ROUND(p.PendingQty,     3)                      AS PendingQty,
        ROUND(psu.PendingQtySU, 3)                      AS PendingQty_StockUnit,
        CASE WHEN q.POQty = 0 THEN 0
             ELSE ROUND(rq.RecdQty * 100.0 / q.POQty, 2)
        END                                             AS PctReceived,

        ROUND(r.Rate, 4)                                AS Rate,
        ru.RateUnit,
        ROUND(vq.ValQtyPend * r.Rate, 2)                AS PendingValue,

        JEJ.JobBookingNo,
        ISNULL(JEJ.ClientName, LM_CL.LedgerName)        AS ClientName

    FROM #POLines                  pl
    JOIN dbo.ItemTransactionDetail ITD_PO WITH (NOLOCK)
         ON ITD_PO.TransactionDetailID = pl.TransactionDetailID
    JOIN dbo.ItemTransactionMain   ITM_PO WITH (NOLOCK)
         ON ITM_PO.TransactionID = pl.TransactionID
    JOIN dbo.ItemMaster            IM     WITH (NOLOCK)
         ON IM.ItemID = ITD_PO.ItemID
        AND IM.CompanyID = @CompanyID
    LEFT JOIN dbo.ItemGroupMaster  IGM    WITH (NOLOCK)
         ON IGM.ItemGroupID = IM.ItemGroupID
        AND IGM.CompanyID   = @CompanyID
    LEFT JOIN dbo.LedgerMaster     LM     WITH (NOLOCK)
         ON LM.LedgerID = ITM_PO.LedgerID
    LEFT JOIN #GRNAgg              g
         ON g.PurchaseTransactionID = ITM_PO.TransactionID
        AND g.ItemID                = ITD_PO.ItemID
    LEFT JOIN #LatestRate          lr
         ON lr.ItemID = ITD_PO.ItemID

    /* Job identity: prefer the column on the detail row, else walk the contents chain */
    LEFT JOIN dbo.JobBookingJobCardContents JCC WITH (NOLOCK)
         ON JCC.JobBookingJobCardContentsID = ITD_PO.RefJobBookingJobCardContentsID
    LEFT JOIN dbo.JobBookingJobCard         JEJ WITH (NOLOCK)
         ON JEJ.JobBookingID = ISNULL(NULLIF(ITD_PO.JobBookingID, 0), JCC.JobBookingID)
    LEFT JOIN dbo.LedgerMaster              LM_CL WITH (NOLOCK)
         ON LM_CL.LedgerID = JEJ.LedgerID

    /* Computed once, reused in SELECT + WHERE + ORDER BY */
    /* PO qty normalised to KG with the SAME ladder used on the GRN side,
       so PendingQty is never a sheet-minus-kg subtraction. */
    CROSS APPLY (SELECT
                    POQty =
                        CASE
                            WHEN UPPER(LTRIM(RTRIM(IM.StockUnit))) IN ('KG','KGS','KGS.')
                                THEN ISNULL(ITD_PO.PurchaseOrderQuantity, 0)
                            WHEN UPPER(LTRIM(RTRIM(IM.StockUnit))) IN ('SHEET','SHEETS')
                                 AND ISNULL(IM.GSM, 0)   > 0
                                 AND ISNULL(IM.SizeW, 0) > 0
                                 AND ISNULL(IM.SizeL, 0) > 0
                                THEN ISNULL(ITD_PO.PurchaseOrderQuantity, 0)
                                     * IM.SizeL * IM.SizeW * IM.GSM / 1000000000.0
                            WHEN ISNULL(ITD_PO.ChallanWeight, 0) > 0
                                THEN ISNULL(ITD_PO.ChallanWeight, 0)
                            ELSE ISNULL(ITD_PO.PurchaseOrderQuantity, 0)
                        END) q
    CROSS APPLY (SELECT RecdQty = ISNULL(g.ReceivedQty_KG, 0)) rq
    CROSS APPLY (SELECT PendingQty = q.POQty - rq.RecdQty) p
    CROSS APPLY (SELECT
                    Rate =
                        CASE WHEN ISNULL(ITD_PO.PurchaseRate, 0) > 0 THEN ITD_PO.PurchaseRate
                             WHEN ISNULL(lr.PurchaseRate, 0)     > 0 THEN lr.PurchaseRate
                             WHEN IM.ItemGroupID IN (14, 2)          THEN 70.0
                             ELSE 0.0
                        END,
                    RateSource =
                        CASE WHEN ISNULL(ITD_PO.PurchaseRate, 0) > 0 THEN 'PO Line'
                             WHEN ISNULL(lr.PurchaseRate, 0)     > 0 THEN 'Latest PO Rate'
                             WHEN IM.ItemGroupID IN (14, 2)          THEN 'Fallback 70'
                             ELSE 'No Rate'
                        END) r

    /* Quantities in the item's own stock unit (sheets, nos, ltr...) */
    CROSS APPLY (SELECT
                    POQtySU   = ISNULL(ITD_PO.PurchaseOrderQuantity, 0),
                    RecdQtySU = ISNULL(g.ReceivedQty_StockUnit, 0)) su
    CROSS APPLY (SELECT PendingQtySU = su.POQtySU - su.RecdQtySU) psu

    /* Is the rate per sheet or per KG?  Same rule rpt_job_gp_per_impression
       uses: for group 14 bought in sheets the rate is per sheet, otherwise
       per KG.  The 70 fallback is always a per-KG figure. */
    CROSS APPLY (SELECT RateUnit =
                    CASE
                        WHEN r.RateSource = 'Fallback 70' THEN 'Per KG'
                        WHEN UPPER(LTRIM(RTRIM(ISNULL(IM.PurchaseUnit, IM.StockUnit))))
                             IN ('SHEET','SHEETS') THEN 'Per Sheet'
                        ELSE 'Per KG'
                    END) ru
    CROSS APPLY (SELECT
                    ValQtyPend = CASE WHEN ru.RateUnit = 'Per Sheet' THEN psu.PendingQtySU ELSE p.PendingQty END) vq

    WHERE p.PendingQty > 0
      AND (q.POQty = 0 OR rq.RecdQty / NULLIF(q.POQty, 0) < @ReceiptCutoff)
      AND (@IncludeKraft = 1 OR ISNULL(IM.Quality, '') NOT LIKE '%Kraft%')
      AND (@ItemGroupID IS NULL OR IM.ItemGroupID     =  @ItemGroupID)
      AND (@JobBookingNo IS NULL OR @JobBookingNo = ''
           OR JEJ.JobBookingNo LIKE '%' + @JobBookingNo + '%')

    ORDER BY PendingValue DESC, ITD_PO.ExpectedDeliveryDate
    OPTION (RECOMPILE);
END
GO
