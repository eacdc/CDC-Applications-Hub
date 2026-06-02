class ApiResponse<T> {
  final bool status;
  final T? data;
  final String? error;
  final StatusWarning? statusWarning;

  ApiResponse({
    required this.status,
    this.data,
    this.error,
    this.statusWarning,
  });

  factory ApiResponse.fromJson(Map<String, dynamic> json, T Function(dynamic)? fromJsonT) {
    return ApiResponse<T>(
      status: json['status'] == true,
      data: json['data'] != null && fromJsonT != null ? fromJsonT(json['data']) : json['data'],
      error: json['error'],
      statusWarning: json['statusWarning'] != null ? StatusWarning.fromJson(json['statusWarning']) : null,
    );
  }

  bool get isSuccess => status;
  bool get isError => !status;
  bool get hasStatusWarning => statusWarning != null;
}

class StatusWarning {
  final String message;
  final String statusValue;

  StatusWarning({
    required this.message,
    required this.statusValue,
  });

  factory StatusWarning.fromJson(Map<String, dynamic> json) {
    return StatusWarning(
      message: json['message'] ?? '',
      statusValue: json['statusValue'] ?? '',
    );
  }
}
