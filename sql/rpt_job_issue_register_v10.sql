/*
  rpt_job_issue_register_v10
  ---------------------------------------------------------------------------
  Same as rpt_job_issue_register_v9 (used by GET /api/inventory-summary/jobwise-issued),
  plus a component (job card content) level for the Inventory Summary Tool's
  Jobwise Issued tab: Job -> Component -> rows.

    @ComponentLevel = 0  output is exactly v9's, plus the new columns below
                         (Component columns NULL, Job* columns = the row's own).
    @ComponentLevel = 1  every job key also carries the component
                         (ItemTransactionDetail.JobBookingJobCardContentsID), so
                         each row is one date + job + component, and
                         [Required as per Job] / [Cumulative Issued] /
                         [Excess/(Short)] / [Var %] are the COMPONENT's.

  Where each component's requirement comes from:
    Contents     JobBookingJobCardContents.TotalPaperWeightInKg of that content
    Gang         the gang's primary content (PrimaryJobBookingJobCardContentsID)
    Kraft Alloc  ItemAllocationPending.JobBookingJobCardContentsID
  Issue lines with no component (ContentsID 0) form a "no component" group per
  job, with no requirement of their own.

  New columns, so the job header can still show v9's job-level figures:
    [Component ID], [Component], [Component No]
    [Job Required]          the job's full requirement (all components)
    [Job Cumulative Issued] job-level running issued kg through this row's date
    [Job Opening Issued]    [Job Cumulative Issued] less the job's issue that date
  Per job + date these equal v9's [Required as per Job], [Cumulative Issued] and
  [Opening Issued] at @MatchLevel = 'JOB'. Do not sum them across component rows.

  At 'QUALITY_GSM' with a GSM tolerance, a component can map an issued GSM to a
  different planned GSM than the job as a whole would. The backend uses 'JOB'.

  Deploy: run this whole script once in IndusEnterprise (Kolkata) and once in
  IndusEnterprise2 (Ahmedabad). v9 is untouched. Then run
  rpt_job_issue_register_v10_compare.sql to check v10 against v9.
*/

CREATE OR ALTER PROCEDURE dbo.rpt_job_issue_register_v10
(
      @FromDate         date          = NULL
    , @ToDate           date          = NULL
    , @CompanyID        int           = NULL
    , @JobBookingID     int           = NULL
    , @Mode             varchar(10)   = 'ALL'
    , @IncludeUnissued  bit           = 0
    , @ApplyGangPaper   bit           = 1
    , @VoucherID        int           = -19
    , @MatchLevel       varchar(20)   = 'JOB'       -- 'JOB' | 'QUALITY' | 'QUALITY_GSM'
    , @GsmTolerance     decimal(18,2) = 10
    , @MaxItemNames     int           = 6          -- names listed before '(+n more)'
    , @CumulativeFromStart bit         = 1          -- 1 = carry pre-@FromDate issues into the cumulative
    , @ComponentLevel   bit           = 0          -- 1 = split every job by component
)
AS
BEGIN
    SET NOCOUNT ON;
    SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

    SET @Mode = UPPER(LTRIM(RTRIM(ISNULL(@Mode,'ALL'))));
    IF @Mode NOT IN ('ALL','DATE','JOB','DATEJOB') SET @Mode = 'ALL';

    SET @MatchLevel = UPPER(LTRIM(RTRIM(ISNULL(@MatchLevel,'JOB'))));
    IF @MatchLevel NOT IN ('JOB','QUALITY','QUALITY_GSM') SET @MatchLevel = 'JOB';

    IF ISNULL(@MaxItemNames,0) < 1 SET @MaxItemNames = 6;
    SET @ComponentLevel = ISNULL(@ComponentLevel,0);

    DECLARE @ToExclusive datetime = CASE WHEN @ToDate IS NULL
                                         THEN NULL ELSE DATEADD(day,1,CAST(@ToDate AS datetime)) END;

    /* ================= 1. ITEM DIMENSION ================================ */
    CREATE TABLE #Item
    (
          ItemID int PRIMARY KEY, ItemName nvarchar(255), ItemGroupID int
        , ItemGroupName nvarchar(255), Quality nvarchar(255), GSM decimal(18,2)
        , PurchaseUnit nvarchar(50), StockUnit nvarchar(50)
        , SheetWtKg decimal(18,9), SpecKey nvarchar(300), SpecLabel nvarchar(300)
        , FallbackRateKg decimal(18,2)
    );

    INSERT INTO #Item
    SELECT
          IM.ItemID, IM.ItemName, IM.ItemGroupID, IG.ItemGroupName
        , UPPER(LTRIM(RTRIM(ISNULL(IM.Quality,''))))
        , CAST(ISNULL(IM.GSM,0) AS decimal(18,2))
        , UPPER(LTRIM(RTRIM(ISNULL(IM.PurchaseUnit,''))))
        , UPPER(LTRIM(RTRIM(ISNULL(IM.StockUnit,''))))
        , CAST((ISNULL(IM.GSM,0)/1000.0)*(ISNULL(IM.SizeW,0)/1000.0)*(ISNULL(IM.SizeL,0)/1000.0) AS decimal(18,9))
        , CASE WHEN @MatchLevel = 'JOB'     THEN N'*ALL*'
               WHEN @MatchLevel = 'QUALITY' THEN UPPER(LTRIM(RTRIM(ISNULL(IM.Quality,''))))
               ELSE CONCAT(UPPER(LTRIM(RTRIM(ISNULL(IM.Quality,'')))),'|',
                           CAST(ISNULL(IM.GSM,0) AS decimal(18,2))) END
        , CASE WHEN @MatchLevel = 'JOB'     THEN N'All Paper & Reel'
               WHEN @MatchLevel = 'QUALITY' THEN UPPER(LTRIM(RTRIM(ISNULL(IM.Quality,''))))
               ELSE CONCAT(UPPER(LTRIM(RTRIM(ISNULL(IM.Quality,'')))),' ',
                           CAST(ISNULL(IM.GSM,0) AS decimal(18,2)),' GSM') END
        , CASE
            WHEN UPPER(ISNULL(IM.Quality,'')) LIKE '%FBB%'        THEN 75
            WHEN UPPER(ISNULL(IM.Quality,'')) LIKE '%CBB%'        THEN 75
            WHEN UPPER(ISNULL(IM.Quality,'')) LIKE '%GLOSS ART%'  THEN 80
            WHEN UPPER(ISNULL(IM.Quality,'')) LIKE '%MATT%'       THEN 80
            WHEN UPPER(ISNULL(IM.Quality,'')) LIKE '%GREY BACK%'  THEN 50
            WHEN UPPER(ISNULL(IM.Quality,'')) LIKE '%WHITE BACK%' THEN 55
            WHEN UPPER(ISNULL(IM.Quality,'')) LIKE '%MAPLITHO%'
              OR UPPER(ISNULL(IM.Quality,'')) LIKE '%SSP%'
              OR UPPER(ISNULL(IM.Quality,'')) LIKE '%HIZINE%'     THEN 65
            ELSE 250
          END
    FROM dbo.ItemMaster IM
    LEFT JOIN dbo.ItemGroupMaster IG ON IG.ItemGroupID = IM.ItemGroupID
    WHERE IM.ItemGroupID IN (2,14);

    /* ================= 2. ISSUES ======================================== */
    /* As v9: with @CumulativeFromStart = 1 the lower date bound is not applied
       here; InWindow marks the rows that are displayed. v10 adds ContentsID
       (0 unless @ComponentLevel = 1). */
    CREATE TABLE #Issue
    (
          JobBookingID int, ContentsID bigint NOT NULL, ItemID int, ItemGroupID int, IssueDate date
        , NativeQty decimal(18,3), ParentTransactionID int, LandedRate decimal(18,6) NULL
        , InWindow bit NOT NULL
    );

    INSERT INTO #Issue (JobBookingID, ContentsID, ItemID, ItemGroupID, IssueDate, NativeQty, ParentTransactionID, InWindow)
    SELECT
          ITD.JobBookingID
        , CASE WHEN @ComponentLevel = 1 THEN ISNULL(ITD.JobBookingJobCardContentsID,0) ELSE 0 END
        , ITD.ItemID, ITD.ItemGroupID
        , CAST(COALESCE(ITM.VoucherDate, ITM.CreatedDate) AS date)
        , CAST(ISNULL(ITD.IssueQuantity,0) AS decimal(18,3))
        , ITD.ParentTransactionID
        , CASE WHEN @FromDate IS NULL
                 OR COALESCE(ITM.VoucherDate, ITM.CreatedDate) >= @FromDate
               THEN 1 ELSE 0 END
    FROM dbo.ItemTransactionMain   ITM
    JOIN dbo.ItemTransactionDetail ITD ON ITD.TransactionID = ITM.TransactionID
    WHERE (@VoucherID IS NULL OR ITM.VoucherID = @VoucherID)
      AND (@CumulativeFromStart = 1 OR @FromDate IS NULL
           OR COALESCE(ITM.VoucherDate, ITM.CreatedDate) >= @FromDate)
      AND (@ToExclusive IS NULL OR COALESCE(ITM.VoucherDate, ITM.CreatedDate) <  @ToExclusive)
      AND ISNULL(ITM.IsDeletedTransaction,0) = 0
      AND ISNULL(ITD.IsDeletedTransaction,0) = 0
      AND ITD.IssueQuantity > 0
      AND ITD.JobBookingID  > 0
      AND ITD.ItemGroupID IN (2,14)
      AND (@JobBookingID IS NULL OR ITD.JobBookingID = @JobBookingID)
    OPTION (RECOMPILE);

    CREATE CLUSTERED INDEX IX_Issue ON #Issue (JobBookingID, ContentsID, ItemID);

    /* ================= 3. JOB SCOPE ===================================== */
    CREATE TABLE #JobScope
    (JobBookingID int PRIMARY KEY, JobCardNo nvarchar(100), JobName nvarchar(500), Client nvarchar(500));

    INSERT INTO #JobScope
    SELECT JBC.JobBookingID, JBC.JobBookingNo, JBC.JobName, LM.LedgerName
    FROM dbo.JobBookingJobCard JBC
    JOIN dbo.JobOrderBooking   JB ON JB.OrderBookingID = JBC.OrderBookingID
    JOIN dbo.LedgerMaster      LM ON LM.LedgerID       = JB.LedgerID
    WHERE ISNULL(JBC.IsCancel,0) = 0
      AND ISNULL(JBC.IsDeletedTransaction,0) = 0
      AND (@CompanyID IS NULL OR JBC.CompanyID = @CompanyID)
      AND ( JBC.JobBookingID IN (SELECT DISTINCT JobBookingID FROM #Issue WHERE InWindow = 1)
            OR (@JobBookingID IS NOT NULL AND JBC.JobBookingID = @JobBookingID) )
    OPTION (RECOMPILE);

    DELETE I FROM #Issue I
    WHERE NOT EXISTS (SELECT 1 FROM #JobScope JS WHERE JS.JobBookingID = I.JobBookingID);

    /* costed after the trim — no point rating history we discarded */
    UPDATE I SET I.LandedRate = PR.LandedRate
    FROM #Issue I
    OUTER APPLY (SELECT TOP (1) P.LandedRate
                 FROM dbo.ItemTransactionDetail P
                 WHERE P.TransactionID = I.ParentTransactionID
                   AND P.ItemID        = I.ItemID
                   AND ISNULL(P.IsDeletedTransaction,0) = 0
                 ORDER BY P.TransactionID DESC) PR;

    /* v10: component names, for @ComponentLevel = 1 only */
    CREATE TABLE #Comp (ContentsID bigint PRIMARY KEY, ContentNo nvarchar(128), ComponentName nvarchar(1024));

    IF @ComponentLevel = 1
        INSERT INTO #Comp
        SELECT C.JobBookingJobCardContentsID, C.JobCardContentNo, C.PlanContName
        FROM dbo.JobBookingJobCardContents C
        JOIN #JobScope JS ON JS.JobBookingID = C.JobBookingID
        OPTION (RECOMPILE);

    /* ================= 4. REQUIRED ====================================== */
    CREATE TABLE #Req (JobBookingID int, ContentsID bigint NOT NULL, ItemID int, ReqKg decimal(18,3), ReqSource varchar(20));
    CREATE TABLE #Gang (JobBookingID int PRIMARY KEY, PrimaryContentsID bigint, PrimaryPaperID int, ReqKg decimal(18,3));

    IF @ApplyGangPaper = 1
    BEGIN
        INSERT INTO #Gang
        SELECT G.PrimaryJobBookingID, G.PrimaryContentsID, G.PrimaryPaperID
             , CAST(ROUND(
                 CAST((ISNULL(G.GangRequiredSheets,0)+ISNULL(G.GangMakeReadySheets,0)
                     + ISNULL(G.GangWastageSheets,0)) AS float)
                 / NULLIF(G.TotalCuts,0) * ISNULL(G.PaperSizeW,0)
                 * CASE WHEN G.PlanType='Sheet Planning'
                        THEN ISNULL(G.PaperSizeL,0) ELSE ISNULL(G.CutSizeL,0) END
                 * ISNULL(G.GSM,0)/1000000000.0, 3) AS decimal(18,3))
        FROM
        (
            SELECT GVP.JobBookingID AS PrimaryJobBookingID
                 , MAX(CASE WHEN GVP.GangJobType='Primary' THEN GVP.PrimaryJobBookingJobCardContentsID END) AS PrimaryContentsID
                 , MAX(CASE WHEN GVP.GangJobType='Primary' THEN C_P.PaperID END) AS PrimaryPaperID
                 , MAX(GT.TotalRequiredCutSheets) AS GangRequiredSheets
                 , MAX(CASE WHEN GVP.GangJobType='Primary' THEN ISNULL(C_P.MakeReadyWastageSheet,0) ELSE 0 END) AS GangMakeReadySheets
                 , SUM(ISNULL(C_ALL.WastageSheets,0)) AS GangWastageSheets
                 , MAX(CASE WHEN GVP.GangJobType='Primary'
                            THEN (ISNULL(C_P.CutL,0)*ISNULL(C_P.CutW,0)+ISNULL(C_P.CutLH,0)*ISNULL(C_P.CutHL,0)) ELSE 0 END) AS TotalCuts
                 , MAX(CASE WHEN GVP.GangJobType='Primary' THEN ISNULL(IMD_SW.PaperSizeW,0) ELSE 0 END) AS PaperSizeW
                 , MAX(CASE WHEN GVP.GangJobType='Primary' THEN ISNULL(IMD_SL.PaperSizeL,0) ELSE 0 END) AS PaperSizeL
                 , MAX(CASE WHEN GVP.GangJobType='Primary' AND CHARINDEX('x', C_P.CutSize) > 0
                            THEN CAST(RIGHT(C_P.CutSize, LEN(C_P.CutSize)-CHARINDEX('x', C_P.CutSize)) AS float) ELSE 0 END) AS CutSizeL
                 , MAX(CASE WHEN GVP.GangJobType='Primary' THEN ISNULL(C_P.PlanType,'Sheet Planning') ELSE 'Sheet Planning' END) AS PlanType
                 , MAX(CASE WHEN GVP.GangJobType='Primary' THEN ISNULL(IMD_GSM.GSMValue,0) ELSE 0 END) AS GSM
            FROM dbo.JobBookingJobcardGangView GVP
            JOIN dbo.JobBookingJobcardGangView GV_ALL ON GV_ALL.GangWorkOrderNo = GVP.GangWorkOrderNo
            LEFT JOIN dbo.JobBookingJobCardContents C_P
                   ON C_P.JobBookingJobCardContentsID = GVP.PrimaryJobBookingJobCardContentsID
                  AND ISNULL(C_P.IsDeletedTransaction,0) = 0
            LEFT JOIN dbo.JobBookingJobCardContents C_ALL
                   ON C_ALL.JobBookingJobCardContentsID = GV_ALL.JobBookingJobCardContentsID
                  AND ISNULL(C_ALL.IsDeletedTransaction,0) = 0
            LEFT JOIN dbo.JobBookingJobCardGang GT ON GT.GangWorkOrderID = GVP.GangWorkOrderID
            LEFT JOIN (SELECT ItemID, CAST(FieldValue AS float) AS GSMValue FROM dbo.ItemMasterDetails
                       WHERE FieldName='GSM' AND ISNULL(FieldValue,'')<>'') IMD_GSM ON IMD_GSM.ItemID = C_P.PaperID
            LEFT JOIN (SELECT ItemID, CAST(FieldValue AS float) AS PaperSizeW FROM dbo.ItemMasterDetails
                       WHERE FieldName='SizeW' AND ISNULL(FieldValue,'')<>'') IMD_SW ON IMD_SW.ItemID = C_P.PaperID
            LEFT JOIN (SELECT ItemID, CAST(FieldValue AS float) AS PaperSizeL FROM dbo.ItemMasterDetails
                       WHERE FieldName='SizeL' AND ISNULL(FieldValue,'')<>'') IMD_SL ON IMD_SL.ItemID = C_P.PaperID
            WHERE GVP.GangJobType = 'Primary'
              AND GVP.JobBookingID IN (SELECT JobBookingID FROM #JobScope)
            GROUP BY GVP.JobBookingID
        ) G
        WHERE ISNULL(G.TotalCuts,0) > 0 AND ISNULL(G.PrimaryPaperID,0) > 0
        OPTION (RECOMPILE);

        DELETE FROM #Gang WHERE ISNULL(ReqKg,0) = 0;

        INSERT INTO #Req (JobBookingID, ContentsID, ItemID, ReqKg, ReqSource)
        SELECT JobBookingID
             , CASE WHEN @ComponentLevel = 1 THEN ISNULL(PrimaryContentsID,0) ELSE 0 END
             , PrimaryPaperID, ReqKg, 'Gang'
        FROM #Gang;
    END

    INSERT INTO #Req (JobBookingID, ContentsID, ItemID, ReqKg, ReqSource)
    SELECT C.JobBookingID
         , CASE WHEN @ComponentLevel = 1 THEN C.JobBookingJobCardContentsID ELSE 0 END
         , C.PaperID
         , CAST(SUM(ISNULL(C.TotalPaperWeightInKg,0)) AS decimal(18,3)), 'Contents'
    FROM dbo.JobBookingJobCardContents C
    JOIN #JobScope JS ON JS.JobBookingID = C.JobBookingID
    WHERE ISNULL(C.IsDeletedTransaction,0) = 0
      AND ISNULL(C.PaperID,0) > 0
      AND NOT EXISTS (SELECT 1 FROM #Gang G WHERE G.JobBookingID = C.JobBookingID)
    GROUP BY C.JobBookingID
           , CASE WHEN @ComponentLevel = 1 THEN C.JobBookingJobCardContentsID ELSE 0 END
           , C.PaperID
    HAVING SUM(ISNULL(C.TotalPaperWeightInKg,0)) <> 0
    OPTION (RECOMPILE);

    /* the "already planned" test stays at job + item, as in v9, so the job's
       total requirement is the same at either level */
    INSERT INTO #Req (JobBookingID, ContentsID, ItemID, ReqKg, ReqSource)
    SELECT IA.JobBookingID
         , CASE WHEN @ComponentLevel = 1 THEN ISNULL(IA.JobBookingJobCardContentsID,0) ELSE 0 END
         , IA.ItemID
         , CAST(SUM(CASE WHEN UPPER(ISNULL(IA.StockUnit,'')) IN ('SHEET','SHEETS')
                         THEN ISNULL(IA.BookedQuantity,0)*ISNULL(IA.GSM,0)*ISNULL(IA.SizeW,0)*ISNULL(IA.SizeL,0)/1000.0/1000.0/1000.0
                         ELSE ISNULL(IA.BookedQuantity,0) END) AS decimal(18,3)), 'Kraft Alloc'
    FROM dbo.ItemAllocationPending IA
    JOIN #JobScope JS ON JS.JobBookingID = IA.JobBookingID
    WHERE IA.Quality LIKE 'Kraft%'
      AND NOT EXISTS (SELECT 1 FROM #Req R WHERE R.JobBookingID = IA.JobBookingID AND R.ItemID = IA.ItemID)
    GROUP BY IA.JobBookingID
           , CASE WHEN @ComponentLevel = 1 THEN ISNULL(IA.JobBookingJobCardContentsID,0) ELSE 0 END
           , IA.ItemID
    HAVING SUM(ISNULL(IA.BookedQuantity,0)) <> 0
    OPTION (RECOMPILE);

    CREATE TABLE #ReqSpec
    (
          JobBookingID int, ContentsID bigint NOT NULL, SpecKey nvarchar(300), SpecLabel nvarchar(300)
        , PlannedItemName nvarchar(255), ItemGroupID int, ItemGroupName nvarchar(255)
        , Quality nvarchar(255), MinGSM decimal(18,2), MaxGSM decimal(18,2)
        , ReqGSMText nvarchar(50), ReqSource varchar(20), ReqKg decimal(18,3)
        , PRIMARY KEY (JobBookingID, ContentsID, SpecKey)
    );

    INSERT INTO #ReqSpec
    SELECT
          R.JobBookingID, R.ContentsID, D.SpecKey, MAX(D.SpecLabel), MAX(D.ItemName)
        , MAX(D.ItemGroupID), MAX(D.ItemGroupName), MAX(D.Quality)
        , MIN(D.GSM), MAX(D.GSM)
        , CASE WHEN MIN(D.GSM) = MAX(D.GSM) THEN CAST(CAST(MIN(D.GSM) AS int) AS nvarchar(20))
               ELSE CONCAT(CAST(MIN(D.GSM) AS int),'-',CAST(MAX(D.GSM) AS int)) END
        , MAX(R.ReqSource), CAST(SUM(R.ReqKg) AS decimal(18,3))
    FROM #Req R
    JOIN #Item D ON D.ItemID = R.ItemID
    GROUP BY R.JobBookingID, R.ContentsID, D.SpecKey;

    /* v10: the job's requirement per spec across all its components */
    CREATE TABLE #JobReqSpec (JobBookingID int, SpecKey nvarchar(300), ReqKg decimal(18,3), PRIMARY KEY (JobBookingID, SpecKey));

    INSERT INTO #JobReqSpec
    SELECT JobBookingID, SpecKey, CAST(SUM(ReqKg) AS decimal(18,3))
    FROM #ReqSpec
    GROUP BY JobBookingID, SpecKey;

    /* ================= 4b. SPEC MATCHING ================================ */
    CREATE TABLE #SpecMap
    (JobBookingID int, ContentsID bigint NOT NULL, IssuedSpecKey nvarchar(300), MappedSpecKey nvarchar(300)
     , MatchType nvarchar(60), PRIMARY KEY (JobBookingID, ContentsID, IssuedSpecKey));

    CREATE TABLE #IssueSpec
    (JobBookingID int, ContentsID bigint NOT NULL, SpecKey nvarchar(300), Quality nvarchar(255), GSM decimal(18,2)
     , PRIMARY KEY (JobBookingID, ContentsID, SpecKey));

    INSERT INTO #IssueSpec
    SELECT I.JobBookingID, I.ContentsID, D.SpecKey, MAX(D.Quality), MAX(D.GSM)
    FROM #Issue I JOIN #Item D ON D.ItemID = I.ItemID
    GROUP BY I.JobBookingID, I.ContentsID, D.SpecKey;

    INSERT INTO #SpecMap
    SELECT I.JobBookingID, I.ContentsID, I.SpecKey, I.SpecKey, 'Matched'
    FROM #IssueSpec I
    JOIN #ReqSpec R ON R.JobBookingID = I.JobBookingID AND R.ContentsID = I.ContentsID AND R.SpecKey = I.SpecKey;

    IF @MatchLevel = 'QUALITY_GSM' AND @GsmTolerance > 0
    BEGIN
        INSERT INTO #SpecMap
        SELECT JobBookingID, ContentsID, IssuedSpecKey, ReqSpecKey
             , CONCAT('GSM ', CAST(IssuedGSM AS int), ' -> ', CAST(ReqGSM AS int))
        FROM
        (
            SELECT I.JobBookingID, I.ContentsID, I.SpecKey AS IssuedSpecKey, R.SpecKey AS ReqSpecKey
                 , I.GSM AS IssuedGSM, R.MaxGSM AS ReqGSM
                 , ROW_NUMBER() OVER
                   (PARTITION BY I.JobBookingID, I.ContentsID, I.SpecKey
                    ORDER BY CASE WHEN EXISTS (SELECT 1 FROM #SpecMap M2
                                               WHERE M2.JobBookingID  = I.JobBookingID
                                                 AND M2.ContentsID    = I.ContentsID
                                                 AND M2.MappedSpecKey = R.SpecKey)
                                  THEN 1 ELSE 0 END
                           , ABS(R.MaxGSM - I.GSM)) AS rn
            FROM #IssueSpec I
            JOIN #ReqSpec  R ON R.JobBookingID = I.JobBookingID
                            AND R.ContentsID   = I.ContentsID
                            AND R.Quality      = I.Quality
                            AND ABS(R.MaxGSM - I.GSM) <= @GsmTolerance
            WHERE NOT EXISTS (SELECT 1 FROM #SpecMap M
                              WHERE M.JobBookingID = I.JobBookingID AND M.ContentsID = I.ContentsID
                                AND M.IssuedSpecKey = I.SpecKey)
        ) X
        WHERE X.rn = 1;
    END

    /* ================= 5. OUTPUT ======================================== */
    ;WITH Lines AS
    (
        SELECT
              I.JobBookingID, I.ContentsID, I.IssueDate, I.InWindow
            , ISNULL(SM.MappedSpecKey, D.SpecKey)                          AS SpecKey
            , ISNULL(RS.SpecLabel, D.SpecLabel)                            AS SpecLabel
            , ISNULL(SM.MatchType, 'Unmatched')                            AS MatchType
            , RS.ReqGSMText, D.GSM                                         AS ItemGSM
            , D.ItemGroupID, D.ItemGroupName, D.StockUnit, D.ItemName
            , I.NativeQty
            , CAST(CASE WHEN I.ItemGroupID = 2  THEN I.NativeQty
                        WHEN I.ItemGroupID = 14 THEN I.NativeQty * D.SheetWtKg
                        ELSE 0 END AS decimal(18,3))                       AS IssuedKg
            , CAST(CASE
                WHEN ISNULL(I.LandedRate,0) > 0 THEN
                    CASE WHEN I.ItemGroupID = 14 AND D.PurchaseUnit IN ('SHEET','SHEETS')
                         THEN I.NativeQty * I.LandedRate
                         ELSE (CASE WHEN I.ItemGroupID=2 THEN I.NativeQty
                                    ELSE I.NativeQty * D.SheetWtKg END) * I.LandedRate END
                ELSE (CASE WHEN I.ItemGroupID=2 THEN I.NativeQty
                           ELSE I.NativeQty * D.SheetWtKg END) * D.FallbackRateKg
              END AS decimal(18,2))                                        AS IssuedCost
            , ROW_NUMBER() OVER (ORDER BY I.JobBookingID, I.ContentsID, ISNULL(SM.MappedSpecKey, D.SpecKey), I.IssueDate, I.ItemID) AS LineSeq
            , ROW_NUMBER() OVER (PARTITION BY I.JobBookingID, I.ContentsID, ISNULL(SM.MappedSpecKey, D.SpecKey)
                                 ORDER BY I.IssueDate, I.ItemID)           AS SeqInJobSpec
        FROM #Issue I
        JOIN #Item     D  ON D.ItemID        = I.ItemID
        JOIN #JobScope JS ON JS.JobBookingID = I.JobBookingID
        LEFT JOIN #SpecMap SM ON SM.JobBookingID = I.JobBookingID AND SM.ContentsID = I.ContentsID AND SM.IssuedSpecKey = D.SpecKey
        LEFT JOIN #ReqSpec RS ON RS.JobBookingID = I.JobBookingID AND RS.ContentsID = I.ContentsID AND RS.SpecKey = SM.MappedSpecKey
    ),
    Combined AS
    (
        SELECT
              L.LineSeq, L.IssueDate, L.InWindow, L.JobBookingID, L.ContentsID, L.SpecKey, L.SpecLabel, L.MatchType
            , L.ReqGSMText, L.ItemGSM, L.ItemGroupID, L.ItemGroupName, L.StockUnit, L.ItemName
            , L.NativeQty, L.IssuedKg, L.IssuedCost
            , CASE WHEN L.SeqInJobSpec = 1 THEN ISNULL(R.ReqKg,0) ELSE 0 END AS ReqAllocated
            , ISNULL(R.ReqKg,0)                                              AS ReqJobTotal
            , ISNULL(R.ReqSource,'(none)')                                   AS ReqSource
            , CASE WHEN R.SpecKey IS NULL THEN 1 ELSE 0 END                  AS IsUnplannedIssue
        FROM Lines L
        LEFT JOIN #ReqSpec R ON R.JobBookingID = L.JobBookingID AND R.ContentsID = L.ContentsID AND R.SpecKey = L.SpecKey

        UNION ALL

        SELECT
              -ROW_NUMBER() OVER (ORDER BY R.JobBookingID, R.ContentsID, R.SpecKey)
            , CAST(NULL AS date), CAST(1 AS bit), R.JobBookingID, R.ContentsID, R.SpecKey, R.SpecLabel, 'No issue'
            , R.ReqGSMText, CAST(NULL AS decimal(18,2))
            , R.ItemGroupID, R.ItemGroupName, CAST('' AS nvarchar(50)), R.PlannedItemName
            , CAST(0 AS decimal(18,3)), CAST(0 AS decimal(18,3)), CAST(0 AS decimal(18,2))
            , R.ReqKg, R.ReqKg, R.ReqSource, 0
        FROM #ReqSpec R
        WHERE @IncludeUnissued = 1
          AND NOT EXISTS (SELECT 1 FROM Lines L
                          WHERE L.JobBookingID = R.JobBookingID AND L.ContentsID = R.ContentsID AND L.SpecKey = R.SpecKey)
    ),
    /* ---- ItemNameRnk / ItemNames: distinct ItemMaster names drawn in each
            output group, deduplicated then ranked so the list can be capped.
            Keyed on the same grouping expressions as Agg. ------------------ */
    ItemNameRnk AS
    (
        SELECT
              D.GrpSpec, D.GrpLineSeq, D.GrpDate, D.GrpJob, D.GrpComp, D.GrpInWin, D.ItemName
            , ROW_NUMBER() OVER (PARTITION BY D.GrpSpec, D.GrpLineSeq, D.GrpDate, D.GrpJob, D.GrpComp, D.GrpInWin
                                 ORDER BY D.ItemName)                        AS rn
            , COUNT(*)    OVER (PARTITION BY D.GrpSpec, D.GrpLineSeq, D.GrpDate, D.GrpJob, D.GrpComp, D.GrpInWin) AS DistinctItems
        FROM
        (
            SELECT DISTINCT
                  C.SpecKey                                                          AS GrpSpec
                , CASE WHEN @Mode='ALL' AND @MatchLevel <> 'JOB' THEN C.LineSeq END  AS GrpLineSeq
                , CASE WHEN @Mode IN ('DATE','DATEJOB')      THEN C.IssueDate    END AS GrpDate
                , CASE WHEN @Mode IN ('ALL','JOB','DATEJOB') THEN C.JobBookingID END AS GrpJob
                , CASE WHEN @Mode IN ('ALL','JOB','DATEJOB') THEN C.ContentsID   END AS GrpComp
                , C.InWindow                                                         AS GrpInWin
                , C.ItemName
            FROM Combined C
            WHERE C.MatchType <> 'No issue'        -- exclude @IncludeUnissued rows
        ) D
    ),
    ItemNames AS
    (
        SELECT
              N.GrpSpec, N.GrpLineSeq, N.GrpDate, N.GrpJob, N.GrpComp, N.GrpInWin
            , MAX(N.DistinctItems)                                           AS ItemCount
            , STRING_AGG(CASE WHEN N.rn <= @MaxItemNames
                              THEN CAST(N.ItemName AS nvarchar(max)) END, ', ')
              WITHIN GROUP (ORDER BY N.ItemName)                             AS NameList
        FROM ItemNameRnk N
        GROUP BY N.GrpSpec, N.GrpLineSeq, N.GrpDate, N.GrpJob, N.GrpComp, N.GrpInWin
    ),
    Agg AS
    (
        SELECT
              C.SpecKey                                              AS GrpSpec
            , CASE WHEN @Mode='ALL' AND @MatchLevel <> 'JOB' THEN C.LineSeq END    AS GrpLineSeq
            , CASE WHEN @Mode IN ('DATE','DATEJOB')      THEN C.IssueDate    END   AS GrpDate
            , CASE WHEN @Mode IN ('ALL','JOB','DATEJOB') THEN C.JobBookingID END   AS GrpJob
            , CASE WHEN @Mode IN ('ALL','JOB','DATEJOB') THEN C.ContentsID   END   AS GrpComp
            , C.InWindow                                                           AS GrpInWin

            , MAX(C.IssueDate)                                       AS IssueDate
            , CASE WHEN @Mode='ALL' AND @MatchLevel <> 'JOB' THEN MAX(C.ItemName)
                   ELSE MAX(C.SpecLabel) END                         AS ItemLabel
            , CASE WHEN COUNT(DISTINCT C.ItemGroupID) = 1
                   THEN MAX(C.ItemGroupName) ELSE 'Paper + Reel' END AS ItemGroupLabel
            , CASE WHEN @Mode IN ('ALL','JOB','DATEJOB') THEN MAX(JS.JobCardNo) END AS JobCardNo
            , CASE WHEN @Mode IN ('ALL','JOB','DATEJOB') THEN MAX(JS.JobName)   END AS JobName
            , CASE WHEN @Mode IN ('ALL','JOB','DATEJOB') THEN MAX(JS.Client)    END AS Client
            , CAST(SUM(C.ReqAllocated) AS decimal(18,3))             AS ReqAllocated
            , CAST(SUM(C.IssuedKg)     AS decimal(18,3))             AS IssuedKg
            , MAX(C.ReqGSMText)                                      AS ReqGSMText
            , CASE WHEN MIN(C.ItemGSM) IS NULL THEN NULL
                   WHEN MIN(C.ItemGSM) = MAX(C.ItemGSM) THEN CAST(CAST(MIN(C.ItemGSM) AS int) AS nvarchar(20))
                   ELSE CONCAT(CAST(MIN(C.ItemGSM) AS int),'-',CAST(MAX(C.ItemGSM) AS int)) END AS IssuedGSMText
            , CAST(MAX(C.ReqJobTotal) AS decimal(18,3))              AS ReqJobTotal
            , MAX(C.MatchType)                                       AS MatchType
            , CASE WHEN COUNT(DISTINCT C.StockUnit) = 1
                   THEN CAST(SUM(C.NativeQty) AS decimal(18,3)) END  AS NativeQty
            , CASE WHEN COUNT(DISTINCT C.StockUnit) = 1
                   THEN MAX(C.StockUnit) ELSE 'MIXED' END            AS StockUnitLabel
            , CAST(SUM(C.IssuedCost) AS decimal(18,2))               AS IssuedCost
            , MAX(C.ReqSource)                                       AS ReqSource
            , MAX(C.IsUnplannedIssue)                                AS IsUnplannedIssue
        FROM Combined C
        JOIN #JobScope JS ON JS.JobBookingID = C.JobBookingID
        GROUP BY
              C.SpecKey
            , CASE WHEN @Mode='ALL' AND @MatchLevel <> 'JOB' THEN C.LineSeq END
            , CASE WHEN @Mode IN ('DATE','DATEJOB')      THEN C.IssueDate    END
            , CASE WHEN @Mode IN ('ALL','JOB','DATEJOB') THEN C.JobBookingID END
            , CASE WHEN @Mode IN ('ALL','JOB','DATEJOB') THEN C.ContentsID   END
            , C.InWindow
    ),
    /* ---- Run: as v9, partitioned on job + component + spec. The Job* figures
            partition on job + spec only. RANGE (not ROWS) for the job running
            total so every component row of a date sees that whole date. ---- */
    Run AS
    (
        SELECT
              A.*
            , SUM(A.IssuedKg) OVER (PARTITION BY ISNULL(A.GrpJob,-1), ISNULL(A.GrpComp,-1), A.GrpSpec
                                    ORDER BY A.IssueDate, A.GrpLineSeq
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS CumIssuedKg
            , MAX(A.ReqJobTotal) OVER (PARTITION BY ISNULL(A.GrpJob,-1), ISNULL(A.GrpComp,-1), A.GrpSpec) AS ReqTotal
            , SUM(A.IssuedKg) OVER (PARTITION BY ISNULL(A.GrpJob,-1), A.GrpSpec
                                    ORDER BY A.IssueDate
                                    RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS JobCumIssuedKg
            , SUM(A.IssuedKg) OVER (PARTITION BY ISNULL(A.GrpJob,-1), A.GrpSpec, A.IssueDate) AS JobDayIssuedKg
            , CONCAT(N.NameList,
                     CASE WHEN N.ItemCount > @MaxItemNames
                          THEN CONCAT(' (+', N.ItemCount - @MaxItemNames, ' more)') END) AS IssuedItems
            , N.ItemCount
        FROM Agg A
        LEFT JOIN ItemNames N
               ON  N.GrpSpec                       = A.GrpSpec
               AND ISNULL(N.GrpLineSeq,-1)         = ISNULL(A.GrpLineSeq,-1)
               AND ISNULL(N.GrpDate,'19000101')    = ISNULL(A.GrpDate,'19000101')
               AND ISNULL(N.GrpJob,-1)             = ISNULL(A.GrpJob,-1)
               AND ISNULL(N.GrpComp,-1)            = ISNULL(A.GrpComp,-1)
               AND N.GrpInWin                      = A.GrpInWin
    )
    SELECT
          R.IssueDate                                              AS [Date]
        , R.ItemLabel                                              AS [Item]
        , R.IssuedItems                                            AS [Issued Items]
        , R.ItemCount                                              AS [Item Count]
        , R.ItemGroupLabel                                         AS [item Group]
        , R.JobCardNo                                              AS [JobNUm]
        , R.JobName                                                AS [Job Name]
        , R.Client                                                 AS [Client]
        , CASE WHEN @ComponentLevel = 1 THEN R.GrpComp END         AS [Component ID]
        , CP.ComponentName                                         AS [Component]
        , CP.ContentNo                                             AS [Component No]

        /* full job (or component) / spec requirement, repeated on every row — do NOT sum */
        , CAST(R.ReqTotal AS decimal(18,3))                        AS [Required as per Job]

        , CAST(R.IssuedKg AS decimal(18,3))                        AS [Issued Qty (In same unit as required)]
        , CAST(R.CumIssuedKg - R.IssuedKg AS decimal(18,3))        AS [Opening Issued]
        , CAST(R.CumIssuedKg AS decimal(18,3))                     AS [Cumulative Issued]
        , 'KG'                                                     AS [Unit]

        /* running variance: cumulative issued vs the full requirement */
        , CAST(R.CumIssuedKg - R.ReqTotal AS decimal(18,3))        AS [Excess/(Short)]
        , CASE WHEN R.ReqTotal > 0
               THEN CAST(100.0*(R.CumIssuedKg - R.ReqTotal)/R.ReqTotal AS decimal(18,1)) END AS [Var %]

        /* v10 job-level figures (all components) — do NOT sum across rows */
        , CAST(CASE WHEN R.GrpJob IS NULL THEN R.ReqTotal
                    ELSE ISNULL(JR.ReqKg,0) END AS decimal(18,3))  AS [Job Required]
        , CAST(R.JobCumIssuedKg AS decimal(18,3))                  AS [Job Cumulative Issued]
        , CAST(R.JobCumIssuedKg - R.JobDayIssuedKg AS decimal(18,3)) AS [Job Opening Issued]

        , R.ReqGSMText                                             AS [Req GSM]
        , R.IssuedGSMText                                          AS [Issued GSM]
        , CAST(R.ReqTotal AS decimal(18,3))                        AS [Req Job Total]
        , CAST(R.ReqAllocated AS decimal(18,3))                    AS [Req Allocated]
        , R.MatchType                                              AS [Spec Match]
        , R.NativeQty                                              AS [Issued Qty (Stock Unit)]
        , R.StockUnitLabel                                         AS [Stock Unit]
        , CAST(R.IssuedCost AS decimal(18,2))                      AS [Issued Cost]
        , R.ReqSource                                              AS [Req Source]
        , R.IsUnplannedIssue                                       AS [Unplanned Issue]
    FROM Run R
    LEFT JOIN #Comp       CP ON CP.ContentsID   = R.GrpComp
    LEFT JOIN #JobReqSpec JR ON JR.JobBookingID = R.GrpJob AND JR.SpecKey = R.GrpSpec
    WHERE R.GrpInWin = 1          -- history rows fed the running SUM; they do not display
    ORDER BY [JobNUm], [Component No], [Item], [Date], R.GrpLineSeq
    OPTION (RECOMPILE);

    DROP TABLE #Item, #Issue, #JobScope, #Comp, #Req, #Gang, #ReqSpec, #JobReqSpec, #IssueSpec, #SpecMap;
END
