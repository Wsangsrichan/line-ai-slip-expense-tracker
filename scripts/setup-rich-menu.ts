import { readFile } from "node:fs/promises";
import { LineRichMenuClient, createRichMenuDefinition, validateRichMenuConfig } from "../src/services/rich-menu.js";

const dryRun = process.argv.includes("--dry-run");
const imagePath = process.env.RICH_MENU_IMAGE_PATH;

async function main() {
  const config = validateRichMenuConfig({
    liffUrl: process.env.LIFF_URL,
    accessToken: dryRun ? "dry-run" : process.env.LINE_CHANNEL_ACCESS_TOKEN,
  });
  const definition = createRichMenuDefinition(config.liffUrl);
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, definition, imageRequired: true }));
    return;
  }
  if (!imagePath) throw new Error("RICH_MENU_IMAGE_PATH is required");
  const imageType = imagePath.toLowerCase().endsWith(".jpg") || imagePath.toLowerCase().endsWith(".jpeg") ? "image/jpeg" : "image/png";
  const image = await readFile(imagePath);
  const id = await new LineRichMenuClient(config.accessToken).ensureDefault(definition, image, imageType);
  console.log(`Rich Menu configured: ${id}`);
}

main().catch(() => {
  console.error("Rich Menu setup failed. Check configuration and the LINE API response.");
  process.exitCode = 1;
});
