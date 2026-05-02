import { Mastra } from "@mastra/core/mastra";
import { Agent } from "@mastra/core/agent";
import { anthropic } from "@ai-sdk/anthropic";

const lyricsWriter = new Agent({
  id: "lyrics-writer",
  name: "lyrics-writer",
  description: "Drafts song lyrics for a given mood/genre/persona.",
  instructions:
    "You write song lyrics. Output plain lyrics with section markers like [Verse 1], [Chorus]. " +
    "No commentary. No AI tells. Match the requested mood, genre, and persona.",
  model: anthropic("claude-haiku-4-5-20251001"),
});

const personaDesigner = new Agent({
  id: "persona-designer",
  name: "persona-designer",
  description: "Designs an artist persona — name, voice, vibe, signature themes.",
  instructions:
    "You design fictional music artist personas. Given a genre seed, output JSON: " +
    "{ name, slug, oneLineBio, voiceDescription, themes: string[], visualStyle }.",
  model: anthropic("claude-haiku-4-5-20251001"),
});

const artPrompter = new Agent({
  id: "art-prompter",
  name: "art-prompter",
  description: "Writes a Flux/Replicate prompt for an album cover.",
  instructions:
    "You write image-generation prompts for album covers. Single paragraph, 60-120 words, vivid concrete imagery, " +
    "no text in the image, no copyrighted IP. Match the album mood and artist visual style.",
  model: anthropic("claude-haiku-4-5-20251001"),
});

export const mastra = new Mastra({
  agents: { lyricsWriter, personaDesigner, artPrompter },
});
