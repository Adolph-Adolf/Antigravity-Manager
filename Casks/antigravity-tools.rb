cask "antigravity-tools" do
  version "4.7.6"
  sha256 :no_check

  name "Antigravity Tools"
  desc "Professional Account Management for AI Services"
  homepage "https://github.com/Adolph-Adolf/Antigravity-Manager"

  on_macos do
    arch intel: "x64", arm: "aarch64"

    url "https://github.com/Adolph-Adolf/Antigravity-Manager/releases/download/v#{version}/Antigravity.Tools_#{version}_#{arch}.dmg"

    app "Antigravity Tools.app"

    postflight_steps do
      run "/usr/bin/xattr",
          args:         ["-rd", "com.apple.quarantine", "{{appdir}}/Antigravity Tools.app"],
          must_succeed: false
    end

    zap trash: [
      "~/Library/Application Support/com.adolphjau.antigravity-tools",
      "~/Library/Caches/com.adolphjau.antigravity-tools",
      "~/Library/Preferences/com.adolphjau.antigravity-tools.plist",
      "~/Library/Saved Application State/com.adolphjau.antigravity-tools.savedState",
    ]
  end

  on_linux do
    arch arm: "aarch64", intel: "amd64"

    url "https://github.com/Adolph-Adolf/Antigravity-Manager/releases/download/v#{version}/Antigravity.Tools_#{version}_#{arch}.AppImage"
    binary "Antigravity.Tools_#{version}_#{arch}.AppImage", target: "antigravity-tools"

    preflight_steps do
      set_permissions "Antigravity.Tools_{{version}}_{{arch}}.AppImage", "0755"
    end
  end
end
