class LoginResult {
  final int? userId;
  final int? ledgerId;
  final List<dynamic> machinesJson;
  final String? selectedDatabase; // echo from server
  final String? currentDb; // actual DB name on server

  LoginResult({
    required this.userId,
    required this.ledgerId,
    required this.machinesJson,
    this.selectedDatabase,
    this.currentDb,
  });

  factory LoginResult.fromJson(Map<String, dynamic> json) {
    return LoginResult(
      userId: json['userId'] == null ? null : int.tryParse(json['userId'].toString()),
      ledgerId: json['ledgerId'] == null ? null : int.tryParse(json['ledgerId'].toString()),
      machinesJson: (json['machines'] as List<dynamic>? ?? const []).toList(),
      selectedDatabase: json['selectedDatabase']?.toString(),
      currentDb: json['currentDb']?.toString(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'userId': userId,
      'ledgerId': ledgerId,
      'machines': machinesJson,
      'selectedDatabase': selectedDatabase,
      'currentDb': currentDb,
    };
  }
}


