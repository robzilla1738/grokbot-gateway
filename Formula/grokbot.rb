# Homebrew-friendly install.
#
# From a clone (no curl | sh):
#   brew install node@22
#   ./scripts/install-cli.sh
#
# From this formula (Homebrew only installs formulae from a tap):
#   brew tap robzilla1738/grokbot-gateway https://github.com/robzilla1738/grokbot-gateway
#   brew install --HEAD robzilla1738/grokbot-gateway/grokbot
class Grokbot < Formula
  desc "CLI and MCP gateway for Desktop Grok Bot"
  homepage "https://github.com/robzilla1738/grokbot-gateway"
  license "MIT"
  head "https://github.com/robzilla1738/grokbot-gateway.git", branch: "main"
  version "0.1.1"

  depends_on "pnpm" => :build
  depends_on "node@22"

  def install
    ENV.prepend_path "PATH", Formula["node@22"].opt_bin
    system "pnpm", "install", "--frozen-lockfile"
    system "pnpm", "build"
    # Swap in production-only dependencies; dist needs them at runtime.
    rm_r "node_modules"
    system "pnpm", "install", "--prod", "--frozen-lockfile", "--ignore-scripts"
    libexec.install "dist", "node_modules", "package.json", "LICENSE", "README.md"
    env = { PATH: "#{Formula["node@22"].opt_bin}:$PATH" }
    (bin/"grokbot").write_env_script libexec/"dist/bin/grokbot.js", env
    (bin/"grokbot-gateway").write_env_script libexec/"dist/bin/grokbot.js", env
  end

  test do
    assert_match "0.1.1", shell_output("#{bin}/grokbot --version")
  end
end
