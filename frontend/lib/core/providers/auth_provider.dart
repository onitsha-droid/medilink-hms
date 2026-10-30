import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hive_flutter/hive_flutter.dart';
import '../api/api_client.dart';
import '../api/auth_models.dart';

// ── Hive box key ──────────────────────────────────────────────────────────────
const _kTokenKey = 'jwt_token';
const _kUserKey = 'auth_user';
const _kBoxName = 'auth';

// ── Auth state ────────────────────────────────────────────────────────────────

/// Represents the three possible auth states.
sealed class AuthState {
  const AuthState();
}

class AuthStateLoading extends AuthState {
  const AuthStateLoading();
}

class AuthStateAuthenticated extends AuthState {
  const AuthStateAuthenticated({required this.user, required this.token});
  final AuthUser user;
  final String token;
}

class AuthStateUnauthenticated extends AuthState {
  const AuthStateUnauthenticated({this.error});
  final String? error;
}

// ── Provider ──────────────────────────────────────────────────────────────────

final authProvider =
    StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref.read(apiClientProvider));
});

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier(this._api, [AuthState? initialState])
      : super(initialState ?? const AuthStateLoading()) {
    if (initialState == null) {
      _restoreSession();
    }
  }

  final ApiClient _api;

  // ── Restore persisted session on cold start ───────────────────────────────

  Future<void> _restoreSession() async {
    try {
      final box = await Hive.openBox<String>(_kBoxName);
      final token = box.get(_kTokenKey);
      final userJson = box.get(_kUserKey);
      if (token != null && userJson != null) {
        // Re-hydrate user from cached JSON string
        final user = AuthUser.fromJson(
          Map<String, dynamic>.from(
            (Uri.splitQueryString(userJson)).map(
              (k, v) => MapEntry(k, v),
            ),
          ),
        );
        _api.setToken(token);
        state = AuthStateAuthenticated(user: user, token: token);
        return;
      }
    } catch (_) {
      // Cache miss or parse error — fall through to unauthenticated
    }
    state = const AuthStateUnauthenticated();
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  Future<void> login(String email, String password) async {
    state = const AuthStateLoading();
    try {
      final response = await _api.login(email, password);
      _api.setToken(response.token);
      await _persistSession(response.token, response.user);
      state = AuthStateAuthenticated(
        user: response.user,
        token: response.token,
      );
    } on ApiException catch (e) {
      state = AuthStateUnauthenticated(error: e.message);
    } catch (_) {
      state = const AuthStateUnauthenticated(
        error: 'An unexpected error occurred. Please try again.',
      );
    }
  }

  // ── Logout ────────────────────────────────────────────────────────────────

  Future<void> logout() async {
    _api.clearToken();
    final box = await Hive.openBox<String>(_kBoxName);
    await box.deleteAll([_kTokenKey, _kUserKey]);
    state = const AuthStateUnauthenticated();
  }

  // ── Persist ───────────────────────────────────────────────────────────────

  Future<void> _persistSession(String token, AuthUser user) async {
    final box = await Hive.openBox<String>(_kBoxName);
    await box.put(_kTokenKey, token);
    // Serialize user as query-string to avoid hive type adapter registration
    final encoded = user.toJson().entries
        .map((e) => '${Uri.encodeComponent(e.key)}=${Uri.encodeComponent(e.value.toString())}')
        .join('&');
    await box.put(_kUserKey, encoded);
  }
}
