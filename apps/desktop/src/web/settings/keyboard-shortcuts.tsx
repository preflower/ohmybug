import { KbdShortcut } from "../components/ui/kbd.js";
import { SETTINGS_SHORTCUTS } from "../keyboard/shortcuts.js";

export function KeyboardShortcutOverview() {
  return (
    <section
      aria-labelledby="keyboard-shortcuts-heading"
      className="settings-option shortcut-settings"
    >
      <div>
        <h3 id="keyboard-shortcuts-heading">键盘快捷键</h3>
        <p>快捷键会根据当前操作系统显示，并在输入控件中暂停响应。</p>
      </div>
      <ul className="shortcut-list">
        {SETTINGS_SHORTCUTS.map((shortcut) => (
          <li key={shortcut.id}>
            <div className="shortcut-copy">
              <strong>{shortcut.label}</strong>
              {shortcut.scope ? <span>{shortcut.scope}</span> : null}
            </div>
            <KbdShortcut accessible shortcut={shortcut} />
          </li>
        ))}
      </ul>
    </section>
  );
}
