import { program } from "commander";
import { add } from "./commands/add";
import fs from "node:fs";

// get version from package.json
const { version, name, description } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"));

program.name(name).description(description).version(version).addCommand(add);

program.parse();