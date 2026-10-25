/// App-level configuration read from compile-time environment variables.
/// Pass them with --dart-define at build time, e.g.:
///   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
library;

class AppConfig {
  const AppConfig._();

  /// Base URL of the MediLink Node.js API.
  /// Default points to the Android emulator loopback for the dev machine.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );

  /// Socket.IO server URL (usually the same host as the API).
  static const String socketUrl = String.fromEnvironment(
    'SOCKET_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );
}
