/* Old vs new Pending PO comparison. Reads only; temp tables vanish with the session.
   Run after deploying v2, once on IndusEnterprise and once on IndusEnterprise2.
   Pass: Rows_only_in_old = 0 and Rows_only_in_new = 0. Also compare the two timings. */
SET NOCOUNT ON;

DECLARE @From DATE = DATEADD(DAY, -30, CAST(GETDATE() AS DATE)),
        @To   DATE = CAST(GETDATE() AS DATE),
        @t    DATETIME2,
        @OldMs INT,
        @NewMs INT;

CREATE TABLE #Old (
    PODetailID BIGINT, PONumber NVARCHAR(200), PODate DATETIME, ExpectedDeliveryDate DATETIME,
    DaysOverdue INT, Supplier NVARCHAR(500), ItemCode NVARCHAR(200), ItemName NVARCHAR(1000),
    Quality NVARCHAR(500), GSM DECIMAL(38,6), Size VARCHAR(30), ItemGroupName NVARCHAR(500),
    StockUnit NVARCHAR(100), POQty DECIMAL(38,6), ReceivedQty DECIMAL(38,6), PendingQty DECIMAL(38,6),
    PendingQty_StockUnit DECIMAL(38,6), PctReceived DECIMAL(38,6), Rate DECIMAL(38,6), RateUnit VARCHAR(20),
    PendingValue DECIMAL(38,6), JobBookingNo NVARCHAR(200), ClientName NVARCHAR(500)
);
SELECT * INTO #New FROM #Old WHERE 1 = 0;

SET @t = SYSDATETIME();
INSERT INTO #Old EXEC dbo.GetPendingPOWithValue @FromDate = @From, @ToDate = @To, @TopN = 2147483647;
SET @OldMs = DATEDIFF(MILLISECOND, @t, SYSDATETIME());

SET @t = SYSDATETIME();
INSERT INTO #New EXEC dbo.GetPendingPOWithValue_v2 @FromDate = @From, @ToDate = @To, @TopN = 2147483647;
SET @NewMs = DATEDIFF(MILLISECOND, @t, SYSDATETIME());

SELECT DB_NAME() AS DatabaseName,
       @OldMs AS Old_ms,
       @NewMs AS New_ms,
       (SELECT COUNT(*) FROM #Old) AS Old_rows,
       (SELECT COUNT(*) FROM #New) AS New_rows,
       (SELECT COUNT(*) FROM (SELECT * FROM #Old EXCEPT SELECT * FROM #New) x) AS Rows_only_in_old,
       (SELECT COUNT(*) FROM (SELECT * FROM #New EXCEPT SELECT * FROM #Old) x) AS Rows_only_in_new;

DROP TABLE #Old;
DROP TABLE #New;
