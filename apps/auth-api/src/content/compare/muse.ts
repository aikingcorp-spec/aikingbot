import { AIKINGBOT_LINKS } from "../../lib/landing-links";
import type { Comparison } from "./comparison";

// Every statement about Muse here is taken from Meta's own pages, and each page used
// is in `sources`. Where Meta states nothing, the text says so. Check them again, and
// move `checkedAt`, whenever this file changes. Statements about AIKINGBOT follow its
// privacy notes and the remote connection that `remote/README.md` describes.

export const MUSE_COMPARISON: Comparison = {
  rival: { name: "Muse", mark: "muse" },
  answer:
    "For most people who want agents for their work, AIKINGBOT is the better choice: your agents use the AI plans you already pay for, such as ChatGPT, Claude, Gemini or Grok, or your own model. They run on your own computer, and the app is free. Choose Muse if you want one personal assistant from Meta that runs on Meta's cloud and helps with email and purchases.",
  chooseAIKINGBOT: [
    "You already pay for ChatGPT, Claude, Gemini, Grok or Cursor, or you run your own model.",
    "Your files and chats must stay on your own computer, not on Meta's cloud.",
    "You want a team of agents that give work to each other, not one assistant.",
    "You live outside the US and Canada, or you want a desktop app for Windows or Linux.",
    "You want a free app, and source code that you can read.",
  ],
  rivalPlans: "Muse uses Muse Spark, Meta's own model. Muse is free with a weekly limit, or $20 or $100 a month.",
  chooseRival: [
    "You want a personal assistant for email and purchases, and no computer to keep on.",
    "You want to talk to it in WhatsApp, and later through Meta's AI glasses.",
    "You pay for no AI plan now and want to start free.",
  ],
  rows: [
    {
      icon: "cpu",
      topic: "Models and plans",
      aikingbot:
        "Use the plans you already have: ChatGPT, Claude, Gemini, Grok or Cursor. Or run free models and your own model through OpenCode. Choose one for each agent, and change it later.",
      rival: "Muse Spark, Meta's own model. Meta states no choice of other models.",
      better: "aikingbot",
    },
    {
      icon: "laptop",
      topic: "Where agents work",
      aikingbot: "On the computer that runs AIKINGBOT.",
      rival:
        "On a dedicated cloud computer that Meta hosts, the Muse Secure VM. With your permission, Muse for Mac can also use the apps on your Mac.",
      better: "aikingbot",
    },
    {
      icon: "cloud",
      topic: "When your computer is off",
      aikingbot:
        "Agents keep working on the computer or server that runs AIKINGBOT, and routines start them on a schedule. If you do not want to keep a computer on, use a hosted AIKINGBOT server in the EU, from €20 or $25 a month.",
      rival: "Muse keeps working after you close the app. You keep no computer on.",
    },
    {
      icon: "phone",
      topic: "Remote access",
      aikingbot:
        "Connect from your phone or another computer. Chats and files go over an encrypted connection between your devices, and no cloud stores them.",
      rival: "You reach Muse through its apps, the web and WhatsApp. Your data stays on your cloud computer at Meta.",
      better: "aikingbot",
    },
    {
      icon: "users",
      topic: "Teams",
      aikingbot:
        "Many agents, each with its own job. They give work to each other in shared channels, and coworkers can join one team host.",
      rival: "One personal agent, with side chats for separate topics. Meta states no team or multi-agent features.",
      better: "aikingbot",
    },
    {
      icon: "lock",
      topic: "Your data",
      aikingbot:
        "Workspaces, chats and files stay in a database on your computer. The provider you choose gets the requests you send.",
      rival:
        "Your data and the sign-ins of connected services are on your cloud computer at Meta. By default, Meta can use your Muse conversations to train its AI models; you can turn this off.",
      better: "aikingbot",
    },
    {
      icon: "tag",
      topic: "Price and account",
      aikingbot:
        "Free for noncommercial use; commercial use needs a license. Your agents use the plans you already pay for.",
      rival:
        "Free with a weekly usage limit. Power costs $20 a month and Maximum $100 a month. Needs an account, and is for people aged 18 or more in the US and Canada.",
      better: "aikingbot",
    },
    {
      icon: "globe",
      topic: "Where you can use it",
      aikingbot:
        "In any country: AIKINGBOT has no region lock. The desktop app is in English, French, Japanese and Turkish, and hosted servers run in the EU. Each AI provider sets the countries for its own plan.",
      rival:
        "Only in the US and Canada, for people 18 and over. Meta says Muse comes to more markets, but gives no countries or dates.",
      better: "aikingbot",
    },
    {
      icon: "devices",
      topic: "Apps",
      aikingbot: "macOS, Windows and Linux, and mobile apps for iPhone and Android.",
      rival:
        "iPhone, Android, Mac, the web and WhatsApp. Meta's AI glasses are next. A Windows or Linux app: not stated by Meta.",
    },
    {
      icon: "code",
      topic: "Source code",
      aikingbot: "On GitHub, under the PolyForm Noncommercial License 1.0.0.",
      rival: "Not stated by Meta.",
      better: "aikingbot",
    },
  ],
  intro:
    "Both products give you an AI agent that does the work, not only answers: it keeps a memory, works on long tasks and comes back to you. The difference is who the agent works for, where it runs, and which model does the thinking. Muse is one personal assistant on Meta's cloud. AIKINGBOT is a team of agents on your own computer, with the AI plans you choose.",
  sections: [
    {
      title: "Models and the plans you pay for",
      aikingbot:
        "AIKINGBOT runs the provider tools you already use, with the plans you already pay for: Codex with your ChatGPT plan, Claude Code with your Claude plan, Gemini with your Google AI Pro or Ultra plan, Grok CLI with your Grok account or an xAI API key, and Cursor CLI with your Cursor plan or a Cursor API key. OpenCode runs free models, or your own model on any OpenAI-compatible server, also one on your computer. You choose the provider, the model and the reasoning effort for each agent. When you move an agent to a different provider, it keeps its role, workspace and conversation.",
      rival:
        "Muse runs on Muse Spark, Meta's own model, and Meta states no way to use a different one. You pay Meta for use: Muse is free with a weekly limit, and the Power and Maximum plans give more Muse tokens each week. A plan that you already pay for at another AI company does not apply.",
      better: "aikingbot",
    },
    {
      title: "Where the work happens",
      aikingbot:
        "AIKINGBOT runs on the computer that hosts it. Agent workspaces, conversations and app data stay on that computer, so it must stay on while its agents work. Run it on a desktop or a server that stays on, and your agents keep working while your laptop is closed. If you do not want to keep a computer on, use a hosted AIKINGBOT server. It is a Linux server in the EU (Germany, Finland or France), from €20 or $25 a month, and it keeps the workspaces and chats of its agents. Local-first is not offline: an agent that uses a hosted provider still sends its requests to that provider.",
      rival:
        "Each Muse lives on its own cloud computer, the Muse Secure VM: a Linux computer with a browser and storage that Meta hosts. Your data and the sign-ins of the services you connect are kept there. Muse keeps working after you close the app. With your permission, Muse for Mac can also use the apps on your Mac.",
      better: "aikingbot",
    },
    {
      title: "Phones and remote access",
      aikingbot:
        "The AIKINGBOT apps for iPhone and Android connect to the computer that runs your agents. From anywhere, you chat with them, follow their progress and send files. The connection goes directly between your devices when it can, it is encrypted, and no cloud stores your chats or files. Remote access needs an AIKINGBOT account.",
      rival:
        "Muse has apps for iPhone and Android, a web app, a Mac app, and a chat in WhatsApp. Meta says Muse comes to its AI glasses in the coming months. Muse itself and your data stay on your cloud computer at Meta.",
      better: "aikingbot",
    },
    {
      title: "One assistant or a team",
      aikingbot:
        "In AIKINGBOT, each agent has a name, a job and its own workspace. A lead agent can give parts of a task to other agents in a shared channel. You follow their work and step in when a decision needs you. For a team of people, one computer runs the host and the others join it; the chats and files stay on the host.",
      rival:
        "Muse is one personal agent for each person. Side chats keep separate topics apart. Meta describes no way to run several agents, to let agents work together, or to share an agent with coworkers.",
      better: "aikingbot",
    },
    {
      title: "Data and privacy",
      aikingbot:
        "AIKINGBOT keeps workspaces, conversations, attachments and browser data in a SQLite database on the computer that runs it. AIKINGBOT keeps no other copy. On a hosted AIKINGBOT server, the database is on that server in the EU. An account holds only your profile, team memberships, invitations, sign-in sessions and the settings that let devices find each other.",
      rival:
        "Muse keeps your data on your cloud computer at Meta. A separate agent, Sentinel, must approve each action through a connected service and all network traffic, and Muse asks you before sensitive actions such as an email or a purchase. By default, Meta can use your conversations to train its models; you can turn this off in Settings. Meta says it does not give Muse conversations or VM data to its ad systems. A Confidential VM that stops Meta from reading the data in your VM is planned for later in 2026.",
      better: "aikingbot",
    },
  ],
  faq: [
    {
      question: "Is AIKINGBOT an alternative to Meta's Muse?",
      answer:
        "Yes, if you want your agents on your own computer. Both give you AI agents that do the work and remember it. AIKINGBOT runs a team of agents on your computer with the AI plans you choose. Muse is one personal agent on a cloud computer that Meta hosts, with Meta's own model.",
    },
    {
      question: "Why choose AIKINGBOT over Muse?",
      answer:
        "Your agents use the AI plans you already pay for, such as ChatGPT, Claude, Gemini or Grok, or your own model. AIKINGBOT keeps your workspaces, chats and files on your own computer, it runs a team of agents instead of one, and it has desktop apps for macOS, Windows and Linux with no country limit. The app is free, and its source code is on GitHub. Muse is the better fit when you want a personal assistant with no computer to keep on.",
    },
    {
      question: "Can I use my ChatGPT, Claude or Gemini subscription with AIKINGBOT?",
      answer:
        "Yes. AIKINGBOT signs in to each provider tool with your own account: your ChatGPT plan for Codex, your Claude plan for Claude Code, and a Google AI Pro or Ultra plan for Gemini. Grok CLI uses your Grok account or an xAI API key, and Cursor CLI your Cursor plan. AIKINGBOT adds no charge of its own.",
    },
    {
      question: "Which model does Muse use?",
      answer:
        "Muse runs on Muse Spark, Meta's own model. Meta states no way to use a model from a different company. Meta says an open-weights release of Muse Spark is on its roadmap.",
    },
    {
      question: "Does Muse run on my computer?",
      answer:
        "Muse lives on a dedicated cloud computer that Meta hosts, the Muse Secure VM. With your permission, Muse for Mac can also use the apps on your Mac. Meta does not state a Windows or Linux app.",
    },
    {
      question: "Does Meta train its models on my Muse chats?",
      answer:
        "By default, Meta can use your Muse conversations to train and improve its AI models. You can turn this off in the Muse settings. Meta says it does not give Muse conversations or VM data to its ad systems. AIKINGBOT keeps your chats on your computer, and only the provider you choose gets the requests your agents send.",
    },
    {
      question: "Do my chats leave my computer with AIKINGBOT?",
      answer:
        "AIKINGBOT keeps workspaces, conversations and files in a database on the computer that runs it, and AIKINGBOT holds no copy. The provider you choose still gets the requests that your agents send to it.",
    },
    {
      question: "Do agents keep working when my laptop is closed?",
      answer:
        "Yes, with both. With AIKINGBOT, run it on a desktop or a server that stays on, or on a hosted AIKINGBOT server, and connect from your laptop or phone. Only that computer must stay on. Muse keeps working on its cloud computer after you close the app.",
    },
    {
      question: "Can I use Muse in Europe?",
      answer:
        "Not for now. Meta offers Muse in the US and Canada, to people aged 18 or more, and says it is working to bring Muse to more markets, with no countries or dates. AIKINGBOT has no country limit: it runs on your computer in any country, hosted AIKINGBOT servers run in the EU, and each provider tool follows its own availability.",
    },
    {
      question: "How much do AIKINGBOT and Muse cost?",
      answer:
        "AIKINGBOT is free for noncommercial use, and commercial use needs a separate license. Each provider tool uses its own plan or API key. Muse is free with a weekly usage limit. The Power plan costs $20 a month for 500 million Muse tokens a week, and the Maximum plan costs $100 a month for 3 billion.",
    },
  ],
  sources: [
    { label: "Meta: Introducing Muse", url: "https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/" },
    {
      label: "Meta: Security and safety for AI agents, our approach with Muse",
      url: "https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse",
    },
    { label: "Meta: Introducing Muse Spark 1.3", url: "https://research.meta.ai/blog/introducing-muse-spark-1-3" },
    {
      label: "Meta: Everything we announced at Connect 2026",
      url: "https://www.meta.com/blog/meta-connect-2026-everything-we-announced/",
    },
    { label: "Muse for Small Business", url: "https://muse.ai/business" },
    { label: "Muse subscription plans", url: "https://www.meta.com/help/subscriptions/1021145227643680/" },
    { label: "Muse side chats", url: "https://www.meta.com/help/artificial-intelligence/1331373868832401/" },
    { label: "Muse Privacy Policy", url: "https://muse.ai/privacy" },
    { label: "Muse Terms", url: "https://muse.ai/terms" },
    { label: "AIKINGBOT privacy notes", url: AIKINGBOT_LINKS.privacy },
    { label: "AIKINGBOT source code", url: AIKINGBOT_LINKS.repository },
  ],
  checkedAt: "2026-10-02",
};
