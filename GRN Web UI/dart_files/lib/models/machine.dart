class Machine {
  final int machineId;
  final String machineName;
  final int? departmentId;
  final int? productUnitId;

  Machine({
    required this.machineId,
    required this.machineName,
    this.departmentId,
    this.productUnitId,
  });

  factory Machine.fromJson(Map<String, dynamic> json) {
    // Handle both camelCase and PascalCase
    final machineIdValue = json['machineId'] ?? json['MachineID'];
    final machineNameValue = json['machineName'] ?? json['MachineName'];
    final departmentIdValue = json['departmentId'] ?? json['DepartmentID'];
    final productUnitIdValue = json['productUnitId'] ?? json['ProductUnitID'];
    
    return Machine(
      machineId: int.parse(machineIdValue.toString()),
      machineName: machineNameValue.toString(),
      departmentId: departmentIdValue == null ? null : int.tryParse(departmentIdValue.toString()),
      productUnitId: productUnitIdValue == null ? null : int.tryParse(productUnitIdValue.toString()),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'machineId': machineId,
      'machineName': machineName,
      'departmentId': departmentId,
      'productUnitId': productUnitId,
    };
  }

  @override
  String toString() {
    return 'Machine(machineId: $machineId, machineName: $machineName, departmentId: $departmentId, productUnitId: $productUnitId)';
  }
}
