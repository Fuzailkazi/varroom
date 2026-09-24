// Placeholder until feature 7 (VAR review agents) adds Google ADK.
// The fixed order of the review pipeline, see CLAUDE.md.
export const PIPELINE_STAGES = ["moderator", "stats_specialist", "fact_checker"] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
