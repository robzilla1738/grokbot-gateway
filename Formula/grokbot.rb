# Homebrew-friendly install.
#
# From a clone (supported today, no curl | sh):
#   brew install node@22
#   ./scripts/install-cli.sh
#
# From this formula once the repo is public:
#   brew install --HEAD Formula/grokbot.rb
class Grokbot < Formula
  desc "CLI and MCP gateway for Desktop Grok Bot"
  homepage "https://github.com/robzilla1738/grokbot-gateway"
  license "MIT"
  head "https://github.com/robzilla1738/grokbot-gateway.git", branch: "main"
  version "0.1.0"

  depends_on "node@22"
  depends_on "pnpm"

  def install
    ENV.prepend_path "PATH", Formula["node@22"].opt_bin
    system "pnpm", "install", "--frozen-lockfile"
    system "pnpm", "build"
    libexec.install "dist", "package.json", "LICENSE", "README.md"
    env = { PATH: "#{Formula["node@22"].opt_bin}:$PATH" }
    (bin/"grokbot").write_env_script libexec/"dist/bin/grokbot.js", env
    (bin/"grokbot-gateway").write_env_script libexec/"dist/bin/grokbot.js", env
  end

  test do
    assert_match "0.1.0", shell_output("#{bin}/grokbot --version")
  end
end
