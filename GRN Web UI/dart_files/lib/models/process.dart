class Process {
  final String pwoNo;
  final String pwoDate;
  final String client;
  final String jobName;
  final String componentName;
  final String formNo;
  final int scheduleQty;
  final int qtyProduced;
  final double? paperIssuedQty;
  final String? currentStatus;
  final String jobcardContentNo;
  final int jobBookingJobcardContentsId;
  final String processName;
  final int? processId;

  Process({
    required this.pwoNo,
    required this.pwoDate,
    required this.client,
    required this.jobName,
    required this.componentName,
    required this.formNo,
    required this.scheduleQty,
    required this.qtyProduced,
    this.paperIssuedQty,
    this.currentStatus,
    required this.jobcardContentNo,
    required this.jobBookingJobcardContentsId,
    required this.processName,
    this.processId,
  });

  factory Process.fromJson(Map<String, dynamic> json) {
    // Handle both camelCase and PascalCase
    return Process(
      pwoNo: (json['pwoNo'] ?? json['PWONo'])?.toString() ?? '',
      pwoDate: (json['pwoDate'] ?? json['PWODate'])?.toString() ?? '',
      client: (json['client'] ?? json['Client'])?.toString() ?? '',
      jobName: (json['jobName'] ?? json['JobName'])?.toString() ?? '',
      componentName: (json['componentName'] ?? json['ComponentName'])?.toString() ?? '',
      formNo: (json['formNo'] ?? json['FormNo'])?.toString() ?? '',
      scheduleQty: int.tryParse((json['scheduleQty'] ?? json['ScheduleQty'])?.toString() ?? '0') ?? 0,
      qtyProduced: int.tryParse((json['qtyProduced'] ?? json['QtyProduced'])?.toString() ?? '0') ?? 0,
      paperIssuedQty: (json['paperIssuedQty'] ?? json['PaperIssuedQty']) == null 
        ? null 
        : double.tryParse((json['paperIssuedQty'] ?? json['PaperIssuedQty']).toString()),
      currentStatus: (json['currentStatus'] ?? json['CurrentStatus'])?.toString(),
      jobcardContentNo: (json['jobcardContentNo'] ?? json['JobCardContentNo'])?.toString() ?? '',
      jobBookingJobcardContentsId: int.tryParse((json['jobBookingJobcardContentsId'] ?? json['JobBookingJobCardContentsID'])?.toString() ?? '0') ?? 0,
      processName: (json['processName'] ?? json['ProcessName'])?.toString() ?? '',
      processId: (json['processId'] ?? json['ProcessID']) == null 
        ? null 
        : int.tryParse((json['processId'] ?? json['ProcessID']).toString()),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'pwoNo': pwoNo,
      'pwoDate': pwoDate,
      'client': client,
      'jobName': jobName,
      'componentName': componentName,
      'formNo': formNo,
      'scheduleQty': scheduleQty,
      'qtyProduced': qtyProduced,
      'paperIssuedQty': paperIssuedQty,
      'currentStatus': currentStatus,
      'jobcardContentNo': jobcardContentNo,
      'jobBookingJobcardContentsId': jobBookingJobcardContentsId,
      'processName': processName,
      'processId': processId,
    };
  }

  @override
  String toString() {
    return 'Process(pwoNo: $pwoNo, client: $client, jobName: $jobName, componentName: $componentName, processName: $processName, formNo: $formNo, scheduleQty: $scheduleQty, qtyProduced: $qtyProduced)';
  }
}
