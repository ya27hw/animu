import DB from "@db/db";
import schedule from "@scheduler/schedule";
import { Command, RUNTIMES } from "@utils/index";
import readline from "readline";
import { interval, offpeakInterval, token } from "profile.json";
import discordBot from "@discord/main";

class ui {
  private commands: Command[];
  private cl: readline.Interface;

  constructor() {
    this.commands = [];
    this.cl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  private addCommands(msg: string, cmd: Function) {
    this.commands.push({
      msg,
      cmd,
    });
  }

  private printCommands(): string {
    return this.commands.map((c, i) => `${i + 1}.\t${c.msg}`).join("\n");
  }

  private async runSchedulerOnce() {
    console.log("===============Checking for Anime...===============");
    await DB.logIn();
    await schedule.check();
    console.log("Done!");
    process.exit();
  }

  private async runScheduler() {
    console.log("Running the scheduler...");
    await DB.logIn();
    // Run every x minutes, from 12:00pm to 04:00am
    // Then run every 25 minutes, from 05:00am to 11:00am
    await schedule.run(RUNTIMES.peak); // Peak hours
    await schedule.run(RUNTIMES.offPeak); // Off peak hours
    schedule.runClearOfflineDB(RUNTIMES.clearOfflineDB); // Clear the offlineDB every day
  }
  private async runSchedulerDiscord() {
    discordBot.start(token);
    this.runScheduler();
  }

  private async selectChoice(arg: number) {
    const cmd = this.commands[arg - 1];
    if (cmd) {
      cmd.cmd();
      this.cl.close();
    } else {
      console.log("Invalid command!");
      this.cl.close();
      process.exit();
    }
  }

  public async init(arg?: string) {
    this.addCommands("Run the Anime Scheduler (once)", this.runSchedulerOnce);
    this.addCommands("Run the Anime Scheduler", this.runScheduler);
    this.addCommands(
      "Run the Anime Scheduler AND Discord Bot (need creds)",
      async () => await this.runSchedulerDiscord()
    );
    this.addCommands("Exit", () => process.exit());

    // Check if arg is a number
    if (arg && !isNaN(Number(arg))) this.selectChoice(Number(arg));
    else {
      console.log(this.printCommands());
      this.cl.question("Enter your choice: ", (answer) => {
        this.selectChoice(Number(answer));
      });
    }
  }
}

export default new ui();
