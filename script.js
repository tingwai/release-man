// GitHub API Client
class GitHubAPI {
  constructor() {
    this.baseURL = "https://api.github.com";
    this.token = null; // Add your token here for higher rate limits
  }

  async request(endpoint) {
    const headers = {
      Accept: "application/vnd.github.v3+json",
    };

    if (this.token) {
      headers["Authorization"] = `token ${this.token}`;
    }

    const response = await fetch(`${this.baseURL}${endpoint}`, { headers });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getRepo(owner, repo) {
    return this.request(`/repos/${owner}/${repo}`);
  }

  async getReleases(owner, repo) {
    return this.request(`/repos/${owner}/${repo}/releases`);
  }

  async getBranches(owner, repo) {
    return this.request(`/repos/${owner}/${repo}/branches`);
  }

  async getTags(owner, repo) {
    return this.request(`/repos/${owner}/${repo}/tags`);
  }

  async checkBranchExists(owner, repo, branchName) {
    try {
      await this.request(`/repos/${owner}/${repo}/branches/${branchName}`);
      return true;
    } catch {
      return false;
    }
  }

  async checkTagExists(owner, repo, tagName) {
    try {
      await this.request(`/repos/${owner}/${repo}/git/refs/tags/${tagName}`);
      return true;
    } catch {
      return false;
    }
  }

  async getPackageJson(owner, repo) {
    try {
      // For continuedev/continue, use the VSCode extension package.json
      const path = owner === "continuedev" && repo === "continue" ? "extensions/vscode/package.json" : "package.json";

      const response = await this.request(`/repos/${owner}/${repo}/contents/${path}`);
      const content = atob(response.content);
      return JSON.parse(content);
    } catch (error) {
      throw new Error("package.json not found");
    }
  }

  async getCommitsSince(owner, repo, sha) {
    try {
      const response = await this.request(`/repos/${owner}/${repo}/commits?sha=main&since=${sha}`);
      return response.length;
    } catch {
      return 0;
    }
  }
}

// Version utilities
class VersionUtils {
  static isValidSemver(version) {
    const cleanVersion = version.replace(/^v/, "");
    const semverRegex = /^\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?$/;
    return semverRegex.test(cleanVersion);
  }

  static compareSemver(version1, version2) {
    const clean1 = version1.replace(/^v/, "").split("-")[0];
    const clean2 = version2.replace(/^v/, "").split("-")[0];

    const parts1 = clean1.split(".").map(Number);
    const parts2 = clean2.split(".").map(Number);

    for (let i = 0; i < 3; i++) {
      if (parts1[i] > parts2[i]) return 1;
      if (parts1[i] < parts2[i]) return -1;
    }
    return 0;
  }

  static getNextVersion(currentVersion, type = "patch") {
    const clean = currentVersion.replace(/^v/, "").split("-")[0];
    const parts = clean.split(".").map(Number);

    switch (type) {
      case "major":
        return `v${parts[0] + 1}.0.0`;
      case "minor":
        return `v${parts[0]}.${parts[1] + 1}.0`;
      case "patch":
      default:
        return `v${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    }
  }

  static isNextVersion(current, next) {
    const cleanCurrent = current.replace(/^v/, "").split("-")[0];
    const cleanNext = next.replace(/^v/, "").split("-")[0];

    const currentParts = cleanCurrent.split(".").map(Number);
    const nextParts = cleanNext.split(".").map(Number);

    // Check if it's exactly one version increment
    if (nextParts[2] === currentParts[2] + 1 && nextParts[1] === currentParts[1] && nextParts[0] === currentParts[0])
      return "patch";

    if (nextParts[1] === currentParts[1] + 1 && nextParts[2] === 0 && nextParts[0] === currentParts[0]) return "minor";

    if (nextParts[0] === currentParts[0] + 1 && nextParts[1] === 0 && nextParts[2] === 0) return "major";

    return false;
  }
}

// Main App
class ReleaseApp {
  constructor() {
    this.api = new GitHubAPI();
    this.currentRepo = null;
    this.repoData = null;
    this.packageData = null;
    this.releases = null;

    this.initEventListeners();
  }

  initEventListeners() {
    document.getElementById("analyze-btn").addEventListener("click", () => this.analyzeRepo());
    document.getElementById("repo-input").addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.analyzeRepo();
    });
    document.getElementById("version-input").addEventListener("input", () => this.validateVersion());

    // Copy functionality
    window.copyToClipboard = (elementId) => {
      const element = document.getElementById(elementId);
      const text = element.textContent;
      navigator.clipboard.writeText(text).then(() => {
        const button = element.nextElementSibling;
        const originalText = button.textContent;
        button.textContent = "Copied!";
        setTimeout(() => {
          button.textContent = originalText;
        }, 2000);
      });
    };
  }

  showLoading() {
    document.getElementById("loading").classList.remove("hidden");
  }

  hideLoading() {
    document.getElementById("loading").classList.add("hidden");
  }

  showError(elementId, message) {
    const errorElement = document.getElementById(elementId);
    errorElement.textContent = message;
    errorElement.classList.add("show");
  }

  hideError(elementId) {
    document.getElementById(elementId).classList.remove("show");
  }

  async analyzeRepo() {
    const repoInput = document.getElementById("repo-input").value.trim();
    this.hideError("repo-error");

    if (!repoInput) {
      this.showError("repo-error", "Please enter a repository name");
      return;
    }

    const [owner, repo] = repoInput.split("/");
    if (!owner || !repo) {
      this.showError("repo-error", "Please use format: owner/repo");
      return;
    }

    this.showLoading();

    try {
      // Fetch repo data
      this.repoData = await this.api.getRepo(owner, repo);
      this.releases = await this.api.getReleases(owner, repo);

      try {
        this.packageData = await this.api.getPackageJson(owner, repo);
      } catch {
        this.packageData = null;
      }

      this.currentRepo = { owner, repo };
      await this.updateCurrentStatus();
      this.showSection("current-status");
      this.showSection("plan-release");
    } catch (error) {
      this.showError("repo-error", `Failed to fetch repository: ${error.message}`);
    } finally {
      this.hideLoading();
    }
  }

  async updateCurrentStatus() {
    // Filter releases ending with "-vscode"
    const vscodeReleases = this.releases.filter((release) => release.tag_name.endsWith("-vscode"));

    const latestRelease = vscodeReleases.find((release) => !release.prerelease);
    const latestPrerelease = vscodeReleases.find((release) => release.prerelease);

    const { owner, repo } = this.currentRepo;

    // Update latest release with hyperlink
    const latestReleaseElement = document.getElementById("latest-release");
    if (latestRelease) {
      const releaseUrl = `https://github.com/${owner}/${repo}/releases/tag/${latestRelease.tag_name}`;
      latestReleaseElement.innerHTML = `<a href="${releaseUrl}" target="_blank" class="release-link">${latestRelease.tag_name}</a>`;
    } else {
      latestReleaseElement.textContent = "No releases";
    }

    // Update latest pre-release with hyperlink
    const latestPrereleaseElement = document.getElementById("latest-prerelease");
    if (latestPrerelease) {
      const prereleaseUrl = `https://github.com/${owner}/${repo}/releases/tag/${latestPrerelease.tag_name}`;
      latestPrereleaseElement.innerHTML = `<a href="${prereleaseUrl}" target="_blank" class="release-link">${latestPrerelease.tag_name}</a>`;
    } else {
      latestPrereleaseElement.textContent = "No pre-releases";
    }

    // Update package.json version
    if (this.packageData) {
      const packageVersion = `v${this.packageData.version}`;
      document.getElementById("package-version").textContent = packageVersion;

      const versionMatch = document.getElementById("version-match");
      if (latestRelease && packageVersion === latestRelease.tag_name) {
        versionMatch.textContent = "✅";
        versionMatch.className = "indicator success";
      } else {
        versionMatch.textContent = "❌";
        versionMatch.className = "indicator danger";
      }
    } else {
      document.getElementById("package-version").textContent = "Not found";
      document.getElementById("version-match").textContent = "❌";
      document.getElementById("version-match").className = "indicator danger";
    }

    // Update last updated
    document.getElementById("last-updated").textContent = latestRelease
      ? new Date(latestRelease.published_at).toLocaleDateString()
      : "-";

    // Update commits since (placeholder for now)
    document.getElementById("commits-since").textContent = "TBD";

    // Pre-fill version input with next patch version and show release process
    if (latestRelease) {
      const nextVersion = this.getNextPatchVersion(latestRelease.tag_name);
      document.getElementById("version-input").value = nextVersion;

      // Automatically show release process with default version
      this.generateReleaseSteps(nextVersion);
      this.showSection("release-process");
      this.checkReleaseSteps(nextVersion);
    }
  }

  async validateVersion() {
    const versionInput = document.getElementById("version-input").value.trim();

    // Only update steps if version is valid, otherwise keep existing steps
    if (versionInput && VersionUtils.isValidSemver(versionInput)) {
      // Generate release process steps
      this.generateReleaseSteps(versionInput);
      this.showSection("release-process");

      // Start checking steps
      this.checkReleaseSteps(versionInput);
    }
    // Don't hide the section if invalid - just don't update it
  }

  updateCheck(checkElement, isValid, message) {
    const indicator = checkElement.querySelector(".indicator");
    const text = checkElement.querySelector("span:last-child");

    if (isValid) {
      checkElement.className = "check-item success";
      indicator.textContent = "✅";
      indicator.className = "indicator success";
    } else {
      checkElement.className = "check-item danger";
      indicator.textContent = "❌";
      indicator.className = "indicator danger";
    }

    text.textContent = message;
  }

  generateReleaseSteps(version) {
    const cleanVersion = version.replace(/^v/, "");
    const vscodeReleases = this.releases.filter((release) => release.tag_name.endsWith("-vscode"));
    const latestRelease = vscodeReleases.find((release) => !release.prerelease);
    const latestPrerelease = vscodeReleases.find((release) => release.prerelease);

    // Use the latest pre-release as the base branch for creating the release branch
    const baseBranch = latestPrerelease ? latestPrerelease.tag_name : `v${cleanVersion.split('.')[0]}.${parseInt(cleanVersion.split('.')[1]) + 1}.x-vscode`;

    // Get previous version for GitHub release (should be the latest stable release)
    const previousVersion = latestRelease ? latestRelease.tag_name : `v${cleanVersion.split('.')[0]}.${cleanVersion.split('.')[1]}.0-vscode`;

    // Update all commands and references
    document.getElementById("branch-command").textContent = `git checkout -b ${version}-vscode-release ${baseBranch}`;
    document.getElementById("target-version").textContent = cleanVersion;
    document.getElementById(
      "commit-command"
    ).textContent = `git add extensions/vscode/package.json && git commit -m "Bump version to ${cleanVersion}"`;
    document.getElementById("push-command").textContent = `git push origin ${version}-vscode-release`;
    document.getElementById("target-branch").textContent = `${version}-vscode-release`;
    document.getElementById("target-tag").textContent = `${version}-vscode`;
    document.getElementById("previous-tag").textContent = previousVersion;
  }

  getNextPatchVersion(currentVersion) {
    const cleanVersion = currentVersion.replace(/^v/, "").replace(/-vscode$/, "");
    const parts = cleanVersion.split(".").map(Number);
    return `v${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }

  async checkReleaseSteps(version) {
    if (!this.currentRepo) {
      return;
    }

    const { owner, repo } = this.currentRepo;
    const releaseBranchName = `${version}-vscode-release`;

    // Reset all checks to pending
    const checks = ["step1-check", "step2-check", "step5-check", "step6-check", "step7-check"];
    checks.forEach((checkId) => {
      const check = document.getElementById(checkId);
      if (check) {
        const indicator = check.querySelector(".indicator");
        indicator.textContent = "⏳";
        indicator.className = "indicator pending";
        check.className = "check-item";
      }
    });

    // Check Step 1: Release branch exists
    try {
      const branchExists = await this.api.checkBranchExists(owner, repo, releaseBranchName);
      const step1Check = document.getElementById('step1-check');

      if (branchExists) {
        this.updateCheckStatus(step1Check, true, 'Release branch exists ✓');
      } else {
        this.updateCheckStatus(step1Check, false, 'Run command to create branch');
      }
    } catch (error) {
      const step1Check = document.getElementById('step1-check');
      this.updateCheckStatus(step1Check, false, 'Error checking release branch');
    }

    // Additional checks can be added here for other steps
  }

  updateCheckStatus(checkElement, isValid, message) {
    const indicator = checkElement.querySelector('.indicator');
    const text = checkElement.querySelector('span:last-child');

    if (isValid) {
      checkElement.className = 'check-item success';
      indicator.textContent = '✅';
      indicator.className = 'indicator success';
    } else {
      checkElement.className = 'check-item danger';
      indicator.textContent = '❌';
      indicator.className = 'indicator danger';
    }

    text.textContent = message;
  }

  showSection(sectionId) {
    document.getElementById(sectionId).classList.remove("hidden");
  }

  hideSection(sectionId) {
    document.getElementById(sectionId).classList.add("hidden");
  }
}

// Initialize app when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  const app = new ReleaseApp();
  // Auto-load the default repository on page load
  app.analyzeRepo();
});
