import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api/api_client.dart';
import 'patient_models.dart';

final patientRepositoryProvider = Provider<PatientRepository>((ref) {
  return PatientRepository(ref.read(apiClientProvider));
});

class PatientRepository {
  const PatientRepository(this._api);
  final ApiClient _api;

  Future<PatientModel> createPatient(CreatePatientRequest req) async {
    final response = await _api.dio.post<Map<String, dynamic>>(
      '/patients',
      data: req.toJson(),
    );
    return PatientModel.fromJson(
        response.data!['patient'] as Map<String, dynamic>);
  }

  Future<PatientModel> getByHospitalId(String hospitalId) async {
    final response = await _api.dio
        .get<Map<String, dynamic>>('/patients/by-hospital-id/$hospitalId');
    return PatientModel.fromJson(
        response.data!['patient'] as Map<String, dynamic>);
  }

  Future<PatientModel> getById(String id) async {
    final response =
        await _api.dio.get<Map<String, dynamic>>('/patients/$id');
    return PatientModel.fromJson(
        response.data!['patient'] as Map<String, dynamic>);
  }
}
