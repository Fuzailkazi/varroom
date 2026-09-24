// temp placeholder for the VAR review agents pipeline
export const PIPELINE_STAGES = ["moderator", "stats_specialist", "fact_checker"] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
