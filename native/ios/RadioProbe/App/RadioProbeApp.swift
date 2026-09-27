import SwiftUI

@main struct RadioProbeApp: App {
    var body: some Scene { WindowGroup { RadioProbeView() } }
}
struct RadioProbeView: View {
    @State private var result = "Connect the Archer T3U to this M-series iPad, enable its driver in Settings if prompted, then read its descriptor."
    var body: some View {
        NavigationStack { Form {
            Section("Archer T3U USB probe") { Text(result).textSelection(.enabled); Button("Read adapter descriptor", action: read) }
            Section { Text("This probe reads the USB identity only. It does not load radio firmware, advertise a lobby, or trade Pokémon.").foregroundStyle(.secondary) }
        }.navigationTitle("Suite Radio Probe") }
    }
    private func read() {
        let matching = IOServiceMatching("IOUserService") as NSMutableDictionary
        matching["IOPropertyMatch"] = ["IOUserClass": "SuiteUSBProbe"]
        let service = IOServiceGetMatchingService(kIOMainPortDefault, matching)
        guard service != 0 else { result = "The Suite USB driver has not matched an adapter. Check its Settings permission and the USB connection."; return }
        defer { IOObjectRelease(service) }
        var connection: io_connect_t = 0
        let opened = IOServiceOpen(service, mach_task_self_, 0, &connection)
        guard opened == KERN_SUCCESS else { result = String(format: "Driver found; app access failed: 0x%08x", opened); return }
        defer { IOServiceClose(connection) }
        var values = [UInt64](repeating: 0, count: 6), count: UInt32 = 6
        let code = IOConnectCallScalarMethod(connection, 0, nil, 0, &values, &count)
        guard code == KERN_SUCCESS, count == 6 else { result = String(format: "Descriptor read failed: 0x%08x", code); return }
        result = String(format: "USB access verified: %04llx:%04llx\nUSB version: %04llx\nControl packet: %llu bytes\nConfigurations: %llu\nDevice revision: %04llx", values[0],values[1],values[2],values[3],values[4],values[5])
    }
}
