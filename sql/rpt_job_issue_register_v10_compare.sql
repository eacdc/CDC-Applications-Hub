/* v9 vs v10 Job Issue Register comparison. Reads only; temp tables vanish with the session.
   Run after deploying v10, once on IndusEnterprise and once on IndusEnterprise2.
   Uses the same parameters as GET /api/inventory-summary/jobwise-issued.

   Pass:
     Check 1  v10 with @ComponentLevel = 0 is v9 row for row:
              Rows_only_in_v9 = 0 and Rows_only_in_v10 = 0.
     Check 2  v10 with @ComponentLevel = 1, rolled up to date + job, gives v9's figures:
              Mismatched_job_dates = 0. Any mismatches are listed underneath.
     Check 3  v10 with @ItemLevel = 1, rolled up to date + job + component, gives the
              component rows of check 2: Mismatched_component_dates = 0. */
SET NOCOUNT ON;

DECLARE @From DATE = DATEADD(DAY, -30, CAST(GETDATE() AS DATE)),
        @To   DATE = CAST(GETDATE() AS DATE),
        @t    DATETIME2,
        @V9Ms INT,
        @V10Ms INT,
        @V10CompMs INT,
        @V10ItemMs INT;

CREATE TABLE #V9 (
    [Date] DATE, [Item] NVARCHAR(300), [Issued Items] NVARCHAR(4000), [Item Count] INT,
    [item Group] NVARCHAR(255), [JobNUm] NVARCHAR(100), [Job Name] NVARCHAR(500), [Client] NVARCHAR(500),
    [Required as per Job] DECIMAL(18,3), [Issued Qty] DECIMAL(18,3), [Opening Issued] DECIMAL(18,3),
    [Cumulative Issued] DECIMAL(18,3), [Unit] VARCHAR(10), [Excess/(Short)] DECIMAL(18,3), [Var %] DECIMAL(18,1),
    [Req GSM] NVARCHAR(50), [Issued GSM] NVARCHAR(50), [Req Job Total] DECIMAL(18,3), [Req Allocated] DECIMAL(18,3),
    [Spec Match] NVARCHAR(60), [Issued Qty (Stock Unit)] DECIMAL(18,3), [Stock Unit] NVARCHAR(50),
    [Issued Cost] DECIMAL(18,2), [Req Source] VARCHAR(20), [Unplanned Issue] INT
);

CREATE TABLE #V10 (
    [Date] DATE, [Item] NVARCHAR(300), [Issued Items] NVARCHAR(4000), [Item Count] INT,
    [item Group] NVARCHAR(255), [JobNUm] NVARCHAR(100), [Job Name] NVARCHAR(500), [Client] NVARCHAR(500),
    [Component ID] BIGINT, [Component] NVARCHAR(1024), [Component No] NVARCHAR(128),
    [Required as per Job] DECIMAL(18,3), [Issued Qty] DECIMAL(18,3), [Opening Issued] DECIMAL(18,3),
    [Cumulative Issued] DECIMAL(18,3), [Unit] VARCHAR(10), [Excess/(Short)] DECIMAL(18,3), [Var %] DECIMAL(18,1),
    [Job Required] DECIMAL(18,3), [Job Cumulative Issued] DECIMAL(18,3), [Job Opening Issued] DECIMAL(18,3),
    [Req GSM] NVARCHAR(50), [Issued GSM] NVARCHAR(50), [Req Job Total] DECIMAL(18,3), [Req Allocated] DECIMAL(18,3),
    [Spec Match] NVARCHAR(60), [Issued Qty (Stock Unit)] DECIMAL(18,3), [Stock Unit] NVARCHAR(50),
    [Issued Cost] DECIMAL(18,2), [Req Source] VARCHAR(20), [Unplanned Issue] INT
);
SELECT * INTO #V10Comp FROM #V10 WHERE 1 = 0;
SELECT * INTO #V10Item FROM #V10 WHERE 1 = 0;

SET @t = SYSDATETIME();
INSERT INTO #V9 EXEC dbo.rpt_job_issue_register_v9
    @FromDate = @From, @ToDate = @To, @CompanyID = 2, @JobBookingID = NULL, @Mode = 'DATEJOB',
    @IncludeUnissued = 0, @ApplyGangPaper = 1, @VoucherID = -19, @MatchLevel = 'JOB', @GsmTolerance = 10;
SET @V9Ms = DATEDIFF(MILLISECOND, @t, SYSDATETIME());

SET @t = SYSDATETIME();
INSERT INTO #V10 EXEC dbo.rpt_job_issue_register_v10
    @FromDate = @From, @ToDate = @To, @CompanyID = 2, @JobBookingID = NULL, @Mode = 'DATEJOB',
    @IncludeUnissued = 0, @ApplyGangPaper = 1, @VoucherID = -19, @MatchLevel = 'JOB', @GsmTolerance = 10,
    @ComponentLevel = 0;
SET @V10Ms = DATEDIFF(MILLISECOND, @t, SYSDATETIME());

SET @t = SYSDATETIME();
INSERT INTO #V10Comp EXEC dbo.rpt_job_issue_register_v10
    @FromDate = @From, @ToDate = @To, @CompanyID = 2, @JobBookingID = NULL, @Mode = 'DATEJOB',
    @IncludeUnissued = 0, @ApplyGangPaper = 1, @VoucherID = -19, @MatchLevel = 'JOB', @GsmTolerance = 10,
    @ComponentLevel = 1;
SET @V10CompMs = DATEDIFF(MILLISECOND, @t, SYSDATETIME());

SET @t = SYSDATETIME();
INSERT INTO #V10Item EXEC dbo.rpt_job_issue_register_v10
    @FromDate = @From, @ToDate = @To, @CompanyID = 2, @JobBookingID = NULL, @Mode = 'DATEJOB',
    @IncludeUnissued = 0, @ApplyGangPaper = 1, @VoucherID = -19, @MatchLevel = 'JOB', @GsmTolerance = 10,
    @ComponentLevel = 1, @ItemLevel = 1;
SET @V10ItemMs = DATEDIFF(MILLISECOND, @t, SYSDATETIME());

/* Check 1: v10 without components, on v9's columns */
SELECT [Date], [Item], [Issued Items], [Item Count], [item Group], [JobNUm], [Job Name], [Client],
       [Required as per Job], [Issued Qty], [Opening Issued], [Cumulative Issued], [Unit], [Excess/(Short)], [Var %],
       [Req GSM], [Issued GSM], [Req Job Total], [Req Allocated], [Spec Match], [Issued Qty (Stock Unit)],
       [Stock Unit], [Issued Cost], [Req Source], [Unplanned Issue]
INTO #V10AsV9
FROM #V10;

/* Check 2: component rows rolled up to date + job */
SELECT [Date], [JobNUm],
       SUM([Issued Qty])             AS IssuedQty,
       SUM([Issued Cost])            AS IssuedCost,
       MAX([Job Required])           AS JobRequired,
       MAX([Job Cumulative Issued])  AS JobCumulative,
       MAX([Job Opening Issued])     AS JobOpening
INTO #Rollup
FROM #V10Comp
GROUP BY [Date], [JobNUm];

SELECT V.[Date], V.[JobNUm],
       V.[Issued Qty] AS V9_IssuedQty,          R.IssuedQty     AS V10_IssuedQty,
       V.[Issued Cost] AS V9_IssuedCost,        R.IssuedCost    AS V10_IssuedCost,
       V.[Required as per Job] AS V9_Required,  R.JobRequired   AS V10_JobRequired,
       V.[Cumulative Issued] AS V9_Cumulative,  R.JobCumulative AS V10_JobCumulative,
       V.[Opening Issued] AS V9_Opening,        R.JobOpening    AS V10_JobOpening
INTO #Mismatch
FROM #V9 V
FULL JOIN #Rollup R ON R.[Date] = V.[Date] AND R.[JobNUm] = V.[JobNUm]
WHERE V.[JobNUm] IS NULL OR R.[JobNUm] IS NULL
   OR V.[Issued Qty]          <> R.IssuedQty
   OR V.[Issued Cost]         <> R.IssuedCost
   OR V.[Required as per Job] <> R.JobRequired
   OR V.[Cumulative Issued]   <> R.JobCumulative
   OR V.[Opening Issued]      <> R.JobOpening;

/* Check 3: item rows rolled up to date + job + component. Within a date the
   running total climbs item by item, so the component's figures are the
   first row's Opening and the last row's Cumulative / Excess. */
SELECT [Date], [JobNUm], [Component ID],
       SUM([Issued Qty])            AS IssuedQty,
       SUM([Issued Cost])           AS IssuedCost,
       MAX([Required as per Job])   AS Required,
       MIN([Opening Issued])        AS Opening,
       MAX([Cumulative Issued])     AS Cumulative,
       MAX([Excess/(Short)])        AS Excess,
       MAX([Job Cumulative Issued]) AS JobCumulative
INTO #ItemRollup
FROM #V10Item
GROUP BY [Date], [JobNUm], [Component ID];

SELECT C.[Date], C.[JobNUm], C.[Component ID],
       C.[Issued Qty] AS Comp_IssuedQty,          I.IssuedQty     AS Item_IssuedQty,
       C.[Issued Cost] AS Comp_IssuedCost,        I.IssuedCost    AS Item_IssuedCost,
       C.[Required as per Job] AS Comp_Required,  I.Required      AS Item_Required,
       C.[Opening Issued] AS Comp_Opening,        I.Opening       AS Item_Opening,
       C.[Cumulative Issued] AS Comp_Cumulative,  I.Cumulative    AS Item_Cumulative,
       C.[Excess/(Short)] AS Comp_Excess,         I.Excess        AS Item_Excess
INTO #ItemMismatch
FROM #V10Comp C
FULL JOIN #ItemRollup I ON I.[Date] = C.[Date] AND I.[JobNUm] = C.[JobNUm] AND I.[Component ID] = C.[Component ID]
WHERE C.[JobNUm] IS NULL OR I.[JobNUm] IS NULL
   OR C.[Issued Qty]          <> I.IssuedQty
   OR C.[Issued Cost]         <> I.IssuedCost
   OR C.[Required as per Job] <> I.Required
   OR C.[Opening Issued]      <> I.Opening
   OR C.[Cumulative Issued]   <> I.Cumulative
   OR C.[Excess/(Short)]      <> I.Excess
   OR C.[Job Cumulative Issued] <> I.JobCumulative;

SELECT DB_NAME() AS DatabaseName,
       @V9Ms AS V9_ms,
       @V10Ms AS V10_ms,
       @V10CompMs AS V10_component_ms,
       @V10ItemMs AS V10_item_ms,
       (SELECT COUNT(*) FROM #V9) AS V9_rows,
       (SELECT COUNT(*) FROM #V10) AS V10_rows,
       (SELECT COUNT(*) FROM #V10Comp) AS V10_component_rows,
       (SELECT COUNT(*) FROM #V10Item) AS V10_item_rows,
       (SELECT COUNT(*) FROM #ItemMismatch) AS Mismatched_component_dates,
       (SELECT COUNT(*) FROM (SELECT * FROM #V9 EXCEPT SELECT * FROM #V10AsV9) x) AS Rows_only_in_v9,
       (SELECT COUNT(*) FROM (SELECT * FROM #V10AsV9 EXCEPT SELECT * FROM #V9) x) AS Rows_only_in_v10,
       (SELECT COUNT(*) FROM #Mismatch) AS Mismatched_job_dates,
       (SELECT COUNT(*) FROM #V10Comp WHERE [Component ID] = 0) AS Rows_with_no_component;

SELECT TOP 50 * FROM #Mismatch ORDER BY [Date], [JobNUm];
SELECT TOP 50 * FROM #ItemMismatch ORDER BY [Date], [JobNUm], [Component ID];

DROP TABLE #V9;
DROP TABLE #V10;
DROP TABLE #V10Comp;
DROP TABLE #V10Item;
DROP TABLE #ItemRollup;
DROP TABLE #ItemMismatch;
DROP TABLE #V10AsV9;
DROP TABLE #Rollup;
DROP TABLE #Mismatch;
