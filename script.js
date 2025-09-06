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

  async compareCommits(owner, repo, base, head) {
    try {
      return await this.request(`/repos/${owner}/${repo}/compare/${base}...${head}`);
    } catch {
      return null;
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

  async getPackageJson(owner, repo, branch = null) {
    try {
      // For continuedev/continue, use the VSCode extension package.json
      const path = owner === "continuedev" && repo === "continue" ? "extensions/vscode/package.json" : "package.json";

      const endpoint = branch
        ? `/repos/${owner}/${repo}/contents/${path}?ref=${branch}`
        : `/repos/${owner}/${repo}/contents/${path}`;

      const response = await this.request(endpoint);
      const content = atob(response.content);
      const parsed = JSON.parse(content);

      // Find line number of version field
      const lines = content.split('\n');
      let versionLineNumber = null;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('"version"') && lines[i].includes(':')) {
          versionLineNumber = i + 1; // GitHub uses 1-based line numbers
          break;
        }
      }

      return { ...parsed, _versionLineNumber: versionLineNumber };
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
    document.getElementById("target-release-version").addEventListener("input", () => this.validateVersion());
    document.getElementById("from-prerelease-version").addEventListener("input", () => this.validateVersion());

    // Copy functionality
    window.copyToClipboard = (elementId) => {
      const element = document.getElementById(elementId);
      const text = element.textContent;

      // Clear any existing selection to prevent text highlighting
      window.getSelection().removeAllRanges();

      navigator.clipboard.writeText(text).then(() => {
        const button = element.nextElementSibling;
        const originalEmoji = button.textContent;

        // Add copied class and change emoji
        button.classList.add("copied");
        button.textContent = "✅";

        setTimeout(() => {
          button.classList.remove("copied");
          button.textContent = originalEmoji;
        }, 1000);
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
      // Fetch initial data in parallel
      const [repoData, releases] = await Promise.all([
        this.api.getRepo(owner, repo),
        this.api.getReleases(owner, repo),
      ]);

      this.repoData = repoData;
      this.releases = releases;
      this.packageData = null; // Will be fetched when needed for branch checking

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

    // Update latest release with hyperlink and date
    const latestReleaseElement = document.getElementById("latest-release");
    const releaseDateElement = document.getElementById("release-date");
    if (latestRelease) {
      const releaseUrl = `https://github.com/${owner}/${repo}/releases/tag/${latestRelease.tag_name}`;
      latestReleaseElement.innerHTML = `<a href="${releaseUrl}" target="_blank" class="release-link">${latestRelease.tag_name}</a>`;
      releaseDateElement.textContent = new Date(latestRelease.published_at).toLocaleDateString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric"
      });
    } else {
      latestReleaseElement.textContent = "No releases";
      releaseDateElement.textContent = "";
    }

    // Update latest pre-release with hyperlink and date
    const latestPrereleaseElement = document.getElementById("latest-prerelease");
    const prereleaseDateElement = document.getElementById("prerelease-date");
    if (latestPrerelease) {
      const prereleaseUrl = `https://github.com/${owner}/${repo}/releases/tag/${latestPrerelease.tag_name}`;
      latestPrereleaseElement.innerHTML = `<a href="${prereleaseUrl}" target="_blank" class="release-link">${latestPrerelease.tag_name}</a>`;
      prereleaseDateElement.textContent = new Date(latestPrerelease.published_at).toLocaleDateString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric"
      });
    } else {
      latestPrereleaseElement.textContent = "No pre-releases";
      prereleaseDateElement.textContent = "";
    }

    // Pre-fill version inputs and show release process
    if (latestRelease) {
      const nextVersion = this.getNextPatchVersion(latestRelease.tag_name);
      document.getElementById("target-release-version").value = nextVersion;

      // Pre-fill from-version with latest pre-release
      const fromVersion = latestPrerelease ? latestPrerelease.tag_name : "";
      document.getElementById("from-prerelease-version").value = fromVersion;

      // Automatically show release process with default version
      this.generateReleaseSteps(nextVersion);
      this.showSection("release-process");
      this.checkReleaseSteps(nextVersion);
    }
  }

  async validateVersion() {
    const versionInput = document.getElementById("target-release-version").value.trim();

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

    // Get base branch from the from-version input
    const fromVersionInput = document.getElementById("from-prerelease-version").value.trim();
    const baseBranch =
      fromVersionInput || `v${cleanVersion.split(".")[0]}.${parseInt(cleanVersion.split(".")[1]) + 1}.x-vscode`;

    // Update all commands and references
    document.getElementById(
      "create-release-branch-command"
    ).textContent = `git checkout -b ${version}-vscode-release ${baseBranch}`;
    document.getElementById("target-version").textContent = cleanVersion;
    document.getElementById("push-release-branch-command").textContent = `git push origin ${version}-vscode-release`;

    // Generate GitHub release URL with query parameters
    const { owner, repo } = this.currentRepo;
    const releaseParams = new URLSearchParams({
      tag: `${version}-vscode`,
      target: `${version}-vscode-release`,
    });

    const releaseUrl = `https://github.com/${owner}/${repo}/releases/new?${releaseParams.toString()}`;
    document.getElementById("create-release-link").href = releaseUrl;

    // Update the instruction text with the actual latest release
    const vscodeReleases = this.releases.filter((release) => release.tag_name.endsWith("-vscode"));
    const latestRelease = vscodeReleases.find((release) => !release.prerelease);
    const latestReleaseTag = latestRelease ? latestRelease.tag_name : "latest release";

    const instructionElement = document.querySelector(".github-release-instructions .step-instruction");
    instructionElement.textContent = `This will open GitHub, select Previous tag: ${latestReleaseTag}, click "Generate release notes" and "Publish release"!`;
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

    // Reset all checks
    const checks = [
      "release-branch-exists-check",
      "package-version-check",
      "github-release-published-check",
    ];
    checks.forEach((checkId) => {
      const check = document.getElementById(checkId);
      if (check) {
        check.className = "check-item";
      }
    });

    // Check both steps in parallel with single branch check
    try {
      const branchExists = await this.api.checkBranchExists(owner, repo, releaseBranchName);
      const branchExistsCheck = document.getElementById("release-branch-exists-check");
      const packageVersionCheck = document.getElementById("package-version-check");
      const branchUrl = `https://github.com/${owner}/${repo}/tree/${releaseBranchName}`;

      // Step 1: Branch exists check
      if (branchExists) {
        this.updateStatus(
          branchExistsCheck,
          true,
          `<a href="${branchUrl}" target="_blank" class="branch-link">Branch ${releaseBranchName} found</a>`
        );

        // Step 2: Package.json version check (only if branch exists)
        try {
          const branchPackageJson = await this.api.getPackageJson(owner, repo, releaseBranchName);
          const expectedVersion = version.replace(/^v/, "");
          const actualVersion = branchPackageJson.version;
          const packageJsonPath =
            owner === "continuedev" && repo === "continue" ? "extensions/vscode/package.json" : "package.json";

          // Build URL with line number if available
          let packageJsonUrl = `https://github.com/${owner}/${repo}/blob/${releaseBranchName}/${packageJsonPath}`;
          if (branchPackageJson._versionLineNumber) {
            packageJsonUrl += `#L${branchPackageJson._versionLineNumber}`;
          }

          if (actualVersion === expectedVersion) {
            this.updateStatus(
              packageVersionCheck,
              true,
              `<a href="${packageJsonUrl}" target="_blank" class="branch-link">package.json version == v${expectedVersion}</a>`
            );
          } else {
            this.updateStatus(
              packageVersionCheck,
              false,
              `<a href="${packageJsonUrl}" target="_blank" class="branch-link">package.json version != v${expectedVersion}</a> (currently v${actualVersion})`
            );
          }
        } catch (error) {
          this.updateStatus(packageVersionCheck, false, "Error checking package.json version");
        }

        // Check for cherry-picked commits if branch exists
        await this.checkCherryPickedCommits(owner, repo, version, releaseBranchName);
      } else {
        this.updateStatus(branchExistsCheck, false, "Release branch missing, run command to create branch");
        this.updateStatus(packageVersionCheck, false, "Release branch not created");

        this.hideCherryPickInfo();
      }
    } catch (error) {
      const branchExistsCheck = document.getElementById("release-branch-exists-check");
      const packageVersionCheck = document.getElementById("package-version-check");
      this.updateStatus(branchExistsCheck, false, "Error checking release branch");
      this.updateStatus(packageVersionCheck, false, "Release branch not created");
      this.hideCherryPickInfo();
    }

    // Step 6: Check if GitHub release exists with target version tag (independent of branch)
    await this.checkGitHubReleaseExists(owner, repo, version);

    // Additional checks can be added here for other steps
  }

  updateStatus(checkElement, isValid, message) {
    const text = checkElement.querySelector("span");

    if (isValid) {
      checkElement.className = "check-item success";
    } else {
      checkElement.className = "check-item danger";
    }

    text.innerHTML = message; // Use innerHTML to support links
  }

  async checkCherryPickedCommits(owner, repo, version, releaseBranchName) {
    try {
      // Compare target release branch to from-prerelease-version branch
      const fromVersionInput = document.getElementById("from-prerelease-version").value.trim();
      if (!fromVersionInput) {
        this.hideCherryPickInfo();
        return;
      }

      const baseBranch = fromVersionInput;
      const comparison = await this.api.compareCommits(owner, repo, baseBranch, releaseBranchName);

      // Always show the comparison section with link, even if no commits
      if (comparison && comparison.commits && comparison.commits.length > 0) {
        this.showCherryPickInfo(owner, repo, baseBranch, releaseBranchName, comparison.commits);
      } else {
        this.showCherryPickInfo(owner, repo, baseBranch, releaseBranchName, []);
      }
    } catch (error) {
      this.hideCherryPickInfo();
    }
  }

  showCherryPickInfo(owner, repo, baseBranch, releaseBranch, commits) {
    const cherryPickInfo = document.getElementById("cherry-picked-commits-info");
    const cherryPickList = document.getElementById("cherry-picked-commits-list");
    const compareLink = document.getElementById("github-compare-link");

    // Clear existing list
    cherryPickList.innerHTML = "";

    // Add commits to list or show "None"
    if (commits.length === 0) {
      const li = document.createElement("li");
      li.textContent = "None";
      cherryPickList.appendChild(li);
    } else {
      commits.forEach((commit) => {
        const li = document.createElement("li");
        const shortSha = commit.sha.substring(0, 7);
        const message = commit.commit.message.split("\n")[0]; // First line only
        const commitUrl = `https://github.com/${owner}/${repo}/commit/${commit.sha}`;

        li.innerHTML = `<a href="${commitUrl}" target="_blank" class="commit-link">${shortSha}</a> ${message}`;
        cherryPickList.appendChild(li);
      });
    }

    // Set compare link
    const compareUrl = `https://github.com/${owner}/${repo}/compare/${baseBranch}...${releaseBranch}`;
    compareLink.href = compareUrl;

    // Show the section
    cherryPickInfo.style.display = "block";
  }

  hideCherryPickInfo() {
    const cherryPickInfo = document.getElementById("cherry-picked-commits-info");
    cherryPickInfo.style.display = "none";
  }

  async checkGitHubReleaseExists(owner, repo, version) {
    const githubReleaseCheck = document.getElementById("github-release-published-check");
    const targetReleaseTag = `${version}-vscode`;

    try {
      // Check if release exists by looking through existing releases
      const targetRelease = this.releases.find((release) => release.tag_name === targetReleaseTag);

      if (targetRelease) {
        const releaseUrl = `https://github.com/${owner}/${repo}/releases/tag/${targetReleaseTag}`;
        this.updateStatus(
          githubReleaseCheck,
          true,
          `<a href="${releaseUrl}" target="_blank" class="release-link">Release ${targetReleaseTag} published</a>`
        );
      } else {
        this.updateStatus(githubReleaseCheck, false, `GitHub release ${targetReleaseTag} not found`);
      }
    } catch (error) {
      this.updateStatus(githubReleaseCheck, false, "Error checking GitHub release status");
    }
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
