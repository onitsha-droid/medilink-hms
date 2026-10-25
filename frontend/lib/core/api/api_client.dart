import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config/app_config.dart';
import 'auth_models.dart';

/// Provider for the typed API client.
final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient();
});

/// Central Dio-based HTTP client.
///
/// • Attaches the JWT automatically via an interceptor once set.
/// • Throws [ApiException] for non-2xx responses so callers get a
///   consistent error type.
class ApiClient {
  ApiClient({String? baseUrl})
      : _dio = Dio(
          BaseOptions(
            baseUrl: baseUrl ?? AppConfig.apiBaseUrl,
            connectTimeout: const Duration(seconds: 10),
            receiveTimeout: const Duration(seconds: 10),
            headers: {'Content-Type': 'application/json'},
          ),
        ) {
    _dio.interceptors.add(_AuthInterceptor(_token));
    _dio.interceptors.add(_ErrorInterceptor());
  }

  final Dio _dio;
  String? _token;

  /// Update the token stored in the interceptor (called after login).
  void setToken(String token) {
    _token = token;
    // Replace the auth interceptor with a fresh one carrying the new token.
    _dio.interceptors.removeWhere((i) => i is _AuthInterceptor);
    _dio.interceptors.insert(0, _AuthInterceptor(_token));
  }

  void clearToken() {
    _token = null;
    _dio.interceptors.removeWhere((i) => i is _AuthInterceptor);
    _dio.interceptors.insert(0, _AuthInterceptor(null));
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  Future<LoginResponse> login(String email, String password) async {
    final response = await _dio.post<Map<String, dynamic>>(
      '/auth/login',
      data: {'email': email, 'password': password},
    );
    return LoginResponse.fromJson(response.data!);
  }

  Future<AuthUser> getMe() async {
    final response =
        await _dio.get<Map<String, dynamic>>('/auth/me');
    return AuthUser.fromJson(
        response.data!['user'] as Map<String, dynamic>);
  }

  // ── Health ──────────────────────────────────────────────────────────────────

  Future<bool> healthCheck() async {
    final response = await _dio.get<Map<String, dynamic>>('/health');
    return response.data?['status'] == 'ok';
  }

  /// Expose the underlying Dio for feature-specific repositories.
  Dio get dio => _dio;
}

// ── Interceptors ──────────────────────────────────────────────────────────────

class _AuthInterceptor extends Interceptor {
  _AuthInterceptor(this._token);
  final String? _token;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (_token != null) {
      options.headers['Authorization'] = 'Bearer $_token';
    }
    handler.next(options);
  }
}

class _ErrorInterceptor extends Interceptor {
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final statusCode = err.response?.statusCode;
    final message = (err.response?.data is Map)
        ? (err.response!.data as Map)['error'] as String? ?? err.message
        : err.message ?? 'Unknown error';
    handler.next(
      DioException(
        requestOptions: err.requestOptions,
        response: err.response,
        type: err.type,
        error: ApiException(message ?? 'Unknown error', statusCode),
      ),
    );
  }
}

/// Structured error thrown by [ApiClient] for non-2xx HTTP responses.
class ApiException implements Exception {
  const ApiException(this.message, [this.statusCode]);
  final String message;
  final int? statusCode;

  bool get isUnauthorized => statusCode == 401;
  bool get isForbidden => statusCode == 403;
  bool get isNotFound => statusCode == 404;

  @override
  String toString() => 'ApiException($statusCode): $message';
}
