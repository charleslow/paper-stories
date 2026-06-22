import { GenerationStats, StageUsage } from '../types';

/** Human labels for the pipeline stage keys written by the CLI. */
const STAGE_LABELS: Record<string, string> = {
  index: 'Index',
  exploration: 'Exploration',
  outline: 'Outline',
  excerpts: 'Excerpts',
  verification: 'Verification',
  explanations: 'Explanations',
  assemble: 'Assembly',
};

const fmt = (n: number | null | undefined): string =>
  typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—';

const fmtCost = (n: number | null | undefined): string =>
  typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(n < 1 ? 4 : 2)}` : '—';

/** A stage's token count: input+output when broken down, else a reported total. */
function stageTokens(s: StageUsage): number | null {
  if (typeof s.inputTokens === 'number' || typeof s.outputTokens === 'number') {
    return (s.inputTokens || 0) + (s.outputTokens || 0);
  }
  return typeof s.totalTokens === 'number' ? s.totalTokens : null;
}

/**
 * Per-stage model + token usage, shown on the overview (first) chapter.
 * Renders whatever telemetry exists: cost column only appears if any stage
 * reported a cost, and the token column degrades to "—" when a runner did not
 * report counts (so the model breakdown still shows).
 */
export default function GenerationStatsPanel({ generation }: { generation: GenerationStats }) {
  if (!generation?.stages?.length) return null;

  const totals = generation.totals ?? null;
  const anyCost = generation.stages.some(s => s.costUsd != null) || totals?.costUsd != null;
  const totalTokens = totals?.totalTokens ?? null;

  return (
    <section className="gen-stats" aria-label="Generation details">
      <h3 className="gen-stats-title">How this story was generated</h3>
      <div className="gen-stats-scroll">
        <table className="gen-stats-table">
          <thead>
            <tr>
              <th>Stage</th>
              <th>Model</th>
              <th className="num">Tokens</th>
              {anyCost && <th className="num">Cost</th>}
            </tr>
          </thead>
          <tbody>
            {generation.stages.map(s => (
              <tr key={s.key}>
                <td>{STAGE_LABELS[s.key] ?? s.key}</td>
                <td className="gen-model">{s.model ?? '—'}</td>
                <td className="num">{fmt(stageTokens(s))}</td>
                {anyCost && <td className="num">{fmtCost(s.costUsd)}</td>}
              </tr>
            ))}
          </tbody>
          {totals && (totalTokens != null || anyCost) && (
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td className="num">{fmt(totalTokens)}</td>
                {anyCost && <td className="num">{fmtCost(totals.costUsd)}</td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="gen-stats-foot">
        Generated as a multi-stage pipeline; cheaper models handle the mechanical stages.
      </p>
    </section>
  );
}
