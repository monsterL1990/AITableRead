const [major, minor] = process.versions.node.split(".").map(Number);
const ltsMajors = new Set([20, 22, 24, 26]);
const supported = ltsMajors.has(major) && !(major === 20 && minor < 9);

if (!supported) {
  console.error(`Node.js ${process.versions.node} is not a supported LTS release for WeiDu.`);
  console.error("Install Node.js LTS 20.9 or newer. Use 22, 24, or 26 from https://nodejs.org/ (the LTS download).");
  console.error("Odd-numbered releases such as 21, 23, or 25 are not LTS.");
  process.exit(1);
}
