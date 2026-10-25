import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as sio;
import '../config/app_config.dart';
import '../providers/auth_provider.dart';

/// Provides the Socket.IO client, wired to the auth token.
/// Automatically reconnects when the auth state changes.
final socketProvider = StateNotifierProvider<SocketNotifier, sio.Socket?>((ref) {
  final notifier = SocketNotifier(ref);
  // React to auth changes
  ref.listen<AuthState>(authProvider, (_, next) {
    if (next is AuthStateAuthenticated) {
      notifier.connect(next.token);
    } else {
      notifier.disconnect();
    }
  });
  // Connect immediately if already authenticated
  final current = ref.read(authProvider);
  if (current is AuthStateAuthenticated) {
    notifier.connect(current.token);
  }
  return notifier;
});

class SocketNotifier extends StateNotifier<sio.Socket?> {
  SocketNotifier(this._ref) : super(null);

  final Ref _ref;

  void connect(String token) {
    // Disconnect existing socket before creating a new one
    state?.disconnect();
    state?.dispose();

    final socket = sio.io(
      AppConfig.socketUrl,
      sio.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': token})
          .enableAutoConnect()
          .enableReconnection()
          .setReconnectionAttempts(double.infinity.toInt())
          .setReconnectionDelay(2000)
          .build(),
    );

    socket.connect();
    state = socket;
  }

  void disconnect() {
    state?.disconnect();
    state?.dispose();
    state = null;
  }

  @override
  void dispose() {
    state?.disconnect();
    state?.dispose();
    super.dispose();
  }
}
