import 'package:json_annotation/json_annotation.dart';

part 'auth_models.g.dart';

/// The eight roles defined in the README.
enum UserRole {
  @JsonValue('Patient')
  patient,
  @JsonValue('Front Desk')
  frontDesk,
  @JsonValue('Nurse')
  nurse,
  @JsonValue('Doctor')
  doctor,
  @JsonValue('Lab Scientist')
  labScientist,
  @JsonValue('Pharmacist')
  pharmacist,
  @JsonValue('Billing Officer')
  billingOfficer,
  @JsonValue('Admin')
  admin;

  /// Human-readable label for display.
  String get label {
    switch (this) {
      case UserRole.patient:
        return 'Patient';
      case UserRole.frontDesk:
        return 'Front Desk';
      case UserRole.nurse:
        return 'Nurse';
      case UserRole.doctor:
        return 'Doctor';
      case UserRole.labScientist:
        return 'Lab Scientist';
      case UserRole.pharmacist:
        return 'Pharmacist';
      case UserRole.billingOfficer:
        return 'Billing Officer';
      case UserRole.admin:
        return 'Admin';
    }
  }
}

@JsonSerializable()
class AuthUser {
  const AuthUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
  });

  final String id;
  final String name;
  final String email;
  final UserRole role;

  factory AuthUser.fromJson(Map<String, dynamic> json) =>
      _$AuthUserFromJson(json);

  Map<String, dynamic> toJson() => _$AuthUserToJson(this);
}

@JsonSerializable()
class LoginResponse {
  const LoginResponse({required this.token, required this.user});

  final String token;
  final AuthUser user;

  factory LoginResponse.fromJson(Map<String, dynamic> json) =>
      _$LoginResponseFromJson(json);

  Map<String, dynamic> toJson() => _$LoginResponseToJson(this);
}
