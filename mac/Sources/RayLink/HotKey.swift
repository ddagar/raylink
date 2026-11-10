import Carbon.HIToolbox

/// System-wide hotkey via Carbon. Needs no Accessibility permission.
final class HotKey {
    private var ref: EventHotKeyRef?
    private static var handlers: [UInt32: () -> Void] = [:]
    private static var installed = false

    init(keyCode: Int, modifiers: Int, id: UInt32 = 1, handler: @escaping () -> Void) {
        HotKey.handlers[id] = handler
        if !HotKey.installed {
            var spec = EventTypeSpec(
                eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
                var hotKeyID = EventHotKeyID()
                GetEventParameter(
                    event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                    nil, MemoryLayout<EventHotKeyID>.size, nil, &hotKeyID)
                HotKey.handlers[hotKeyID.id]?()
                return noErr
            }, 1, &spec, nil, nil)
            HotKey.installed = true
        }
        let hotKeyID = EventHotKeyID(signature: OSType(0x524C_4E4B), id: id)
        RegisterEventHotKey(UInt32(keyCode), UInt32(modifiers), hotKeyID, GetApplicationEventTarget(), 0, &ref)
    }

    var isRegistered: Bool { ref != nil }
}
