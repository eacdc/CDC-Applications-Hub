class MachineStatus {
  final int jobBookingJobCardContentsId;
  final String jobNumber;
  final String jobName;
  final String machineName;
  final String process;
  final String machineStatus;
  final String lastUpdated;

  MachineStatus({
    required this.jobBookingJobCardContentsId,
    required this.jobNumber,
    required this.jobName,
    required this.machineName,
    required this.process,
    required this.machineStatus,
    required this.lastUpdated,
  });

  factory MachineStatus.fromJson(Map<String, dynamic> json) {
    return MachineStatus(
      jobBookingJobCardContentsId: int.tryParse(json['JobBookingJobCardContentsID']?.toString() ?? '0') ?? 0,
      jobNumber: json['Jobnumber']?.toString() ?? '',
      jobName: json['Job Name']?.toString() ?? '',
      machineName: json['MachineNmae']?.toString() ?? '',
      process: json['Process']?.toString() ?? '',
      machineStatus: json['MachineStatus']?.toString() ?? '',
      lastUpdated: json['LastUpadted']?.toString() ?? '',
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'JobBookingJobCardContentsID': jobBookingJobCardContentsId,
      'Jobnumber': jobNumber,
      'Job Name': jobName,
      'MachineNmae': machineName,
      'Process': process,
      'MachineStatus': machineStatus,
      'LastUpadted': lastUpdated,
    };
  }

  @override
  String toString() {
    return 'MachineStatus(jobBookingJobCardContentsId: $jobBookingJobCardContentsId, jobNumber: $jobNumber, jobName: $jobName, machineName: $machineName, process: $process, machineStatus: $machineStatus, lastUpdated: $lastUpdated)';
  }
}
