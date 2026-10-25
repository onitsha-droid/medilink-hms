import 'package:json_annotation/json_annotation.dart';

part 'patient_models.g.dart';

@JsonSerializable()
class PatientAddress {
  const PatientAddress({this.street, this.city, this.state, this.country});

  final String? street;
  final String? city;
  final String? state;
  final String? country;

  factory PatientAddress.fromJson(Map<String, dynamic> json) =>
      _$PatientAddressFromJson(json);

  Map<String, dynamic> toJson() => _$PatientAddressToJson(this);
}

@JsonSerializable()
class PatientHmo {
  const PatientHmo({this.provider, this.memberNumber, this.planType});

  final String? provider;
  final String? memberNumber;
  final String? planType;

  factory PatientHmo.fromJson(Map<String, dynamic> json) =>
      _$PatientHmoFromJson(json);

  Map<String, dynamic> toJson() => _$PatientHmoToJson(this);
}

@JsonSerializable()
class PatientModel {
  const PatientModel({
    required this.id,
    required this.hospitalId,
    required this.firstName,
    required this.lastName,
    required this.dateOfBirth,
    required this.gender,
    required this.phone,
    this.email,
    this.hmo,
    this.nhiaNumber,
    this.address,
    this.qrPayload,
  });

  final String id;
  final String hospitalId;
  final String firstName;
  final String lastName;
  final String dateOfBirth;
  final String gender;
  final String phone;
  final String? email;
  final PatientHmo? hmo;
  final String? nhiaNumber;
  final PatientAddress? address;
  final String? qrPayload;

  String get fullName => '$firstName $lastName';

  factory PatientModel.fromJson(Map<String, dynamic> json) =>
      _$PatientModelFromJson(json);

  Map<String, dynamic> toJson() => _$PatientModelToJson(this);
}

@JsonSerializable()
class CreatePatientRequest {
  const CreatePatientRequest({
    required this.firstName,
    required this.lastName,
    required this.dateOfBirth,
    required this.gender,
    required this.phone,
    this.email,
    this.hmo,
    this.nhiaNumber,
    this.address,
  });

  final String firstName;
  final String lastName;
  final String dateOfBirth;
  final String gender;
  final String phone;
  final String? email;
  final PatientHmo? hmo;
  final String? nhiaNumber;
  final PatientAddress? address;

  factory CreatePatientRequest.fromJson(Map<String, dynamic> json) =>
      _$CreatePatientRequestFromJson(json);

  Map<String, dynamic> toJson() => _$CreatePatientRequestToJson(this);
}
