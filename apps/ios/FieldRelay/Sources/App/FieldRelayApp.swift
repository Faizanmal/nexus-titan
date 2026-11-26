import SwiftUI
import FirebaseCore
import FirebaseAppCheck

class FieldRelayAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil
    ) -> Bool {
        #if DEBUG
        let providerFactory = AppCheckDebugProviderFactory()
        AppCheck.setAppCheckProviderFactory(providerFactory)
        #endif

        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
        }
        return true
    }
}

@main
public struct FieldRelayApp: App {
    @UIApplicationDelegateAdaptor(FieldRelayAppDelegate.self) var delegate

    public init() {}

    public var body: some Scene {
        WindowGroup {
            FieldRelayRootView()
                .preferredColorScheme(.dark)
        }
    }
}
