/*
  Kolkata (IndusEnterprise). One-off: bring REC04812_26_27 and PI04725_26_27,
  the first GRN and purchase invoice saved from GRN Creator (28 Oct 2026), in
  line with how the ERP stores its own. Every value below is what all ERP-made
  GRNs and purchase invoices carry (checked on 18,000+ GRN lines and every
  purchase invoice tax row). Quantities, amounts, tax, ledgers and stock are
  NOT touched - they were already right.

  Run it as a whole. It checks it is changing exactly the expected rows and
  rolls back otherwise.
*/
SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @grn BIGINT = 69808, @pi BIGINT = 8948, @n INT;

IF NOT EXISTS (SELECT 1 FROM ItemTransactionMain WHERE TransactionID = @grn AND VoucherNo = 'REC04812_26_27' AND CompanyID = 2)
   OR NOT EXISTS (SELECT 1 FROM ItemPurchaseInvoiceMain WHERE TransactionID = @pi AND VoucherNo = 'PI04725_26_27' AND CompanyID = 2)
BEGIN
  ROLLBACK; THROW 50000, 'REC04812_26_27 / PI04725_26_27 are not where expected - nothing changed.', 1;
END;

-- GRN header
UPDATE ItemTransactionMain
SET TotalQuantity = 0, BranchID = 0, ModifiedBy = 0,
    Transporter = '', LRNoVehicleNo = '', Narration = ''
WHERE TransactionID = @grn AND CompanyID = 2;
IF @@ROWCOUNT <> 1 BEGIN ROLLBACK; THROW 50001, 'GRN header: expected 1 row.', 1; END;

-- GRN lines
UPDATE ItemTransactionDetail
SET PurchaseOrderQuantity = 0, GrsRate = NULL, ProductHSNID = 0, BranchID = 0, ModifiedBy = 0,
    SupplierBatchNo = '-', MfgDate = '1900-01-01', ExpiryDate = '1900-01-01', ItemDescription = NULL
WHERE TransactionID = @grn AND CompanyID = 2 AND TransactionDetailID IN (119886, 119887);
IF @@ROWCOUNT <> 2 BEGIN ROLLBACK; THROW 50002, 'GRN lines: expected 2 rows.', 1; END;

-- Purchase invoice header and lines
UPDATE ItemPurchaseInvoiceMain SET BranchID = 0 WHERE TransactionID = @pi AND CompanyID = 2;
IF @@ROWCOUNT <> 1 BEGIN ROLLBACK; THROW 50003, 'PI header: expected 1 row.', 1; END;

UPDATE ItemPurchaseInvoiceDetail SET BranchID = 0 WHERE TransactionID = @pi AND CompanyID = 2;
SET @n = @@ROWCOUNT;
IF @n <> 2 BEGIN ROLLBACK; THROW 50004, 'PI lines: expected 2 rows.', 1; END;

-- Purchase invoice tax rows (CGST, SGST)
UPDATE ItemPurchaseInvoiceTaxes
SET TaxTiming = 0, GSTApplicable = 1, BranchID = 0, ModifiedBy = CreatedBy
WHERE TransactionID = @pi AND CompanyID = 2 AND ItemPurchaseInvoiceTaxesID IN (49622, 49623);
IF @@ROWCOUNT <> 2 BEGIN ROLLBACK; THROW 50005, 'PI tax rows: expected 2 rows.', 1; END;

COMMIT;
SELECT 'REC04812_26_27 and PI04725_26_27 now match the ERP''s own vouchers.' AS Result;
