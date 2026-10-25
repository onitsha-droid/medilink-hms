import 'package:json_annotation/json_annotation.dart';

part 'queue_models.g.dart';

@JsonSerializable()
class QueuePosition {
  const QueuePosition({
    required this.position,
    required this.estimatedWaitMinutes,
    required this.clinicId,
  });

  final int position;
  final int estimatedWaitMinutes;
  final String clinicId;

  factory QueuePosition.fromJson(Map<String, dynamic> json) =>
      _$QueuePositionFromJson(json);

  Map<String, dynamic> toJson() => _$QueuePositionToJson(this);
}

@JsonSerializable()
class CheckInRequest {
  const CheckInRequest({
    required this.patientId,
    required this.clinicId,
    this.appointmentId,
  });

  final String patientId;
  final String clinicId;
  final String? appointmentId;

  factory CheckInRequest.fromJson(Map<String, dynamic> json) =>
      _$CheckInRequestFromJson(json);

  Map<String, dynamic> toJson() => _$CheckInRequestToJson(this);
}

@JsonSerializable()
class CheckInResponse {
  const CheckInResponse({
    required this.position,
    required this.estimatedWaitMinutes,
  });

  final int position;
  final int estimatedWaitMinutes;

  factory CheckInResponse.fromJson(Map<String, dynamic> json) =>
      _$CheckInResponseFromJson(json);

  Map<String, dynamic> toJson() => _$CheckInResponseToJson(this);
}
