import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { finalize } from 'rxjs';

export type GateStatus = 'PASS' | 'RISK' | 'FAIL' | 'READY';

interface Gate {
  name: string;
  system: string;
  icon: string;
  status: GateStatus;
  score: number;
  detail: string;
  metric: string;
}

interface ReleaseScenario {
  id: string;
  name: string;
  date: string;
  previousReleaseId: string;
  score: number;
  decision: string;
  summary: string;
  risks: string[];
  gates: Gate[];
  blockers: string[];
  changes: string[];
}

interface ApiGate {
  type: string;
  status: string;
  score: number;
  headline: string;
  findings?: string[];
  blockers?: string[];
}

interface ApiRelease {
  id: string;
  name: string;
  releaseDate: string;
  previousReleaseId?: string;
  gates: ApiGate[];
  changes?: string[];
  score?: number;
  decision?: string;
  blockers?: string[];
  releaseSummary?: string;
  risks?: string[];
}

interface ApiReleaseResponse extends ApiRelease {
  releaseId?: string;
  release?: ApiRelease;
  data?: ApiRelease;
  result?: ApiRelease;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:8080';
  readonly scenarios = signal<ReleaseScenario[]>([]);
  readonly selectedId = signal('');
  readonly isLoading = signal(true);
  readonly errorMessage = signal('');
  readonly isAnalyzing = signal(false);
  readonly showChanges = signal(false);
  readonly showSummary = signal(false);
  readonly selected = computed(() => this.scenarios().find((scenario) => scenario.id === this.selectedId()) ?? this.fallbackScenario);
  readonly hasBlocker = computed(() => this.selected().blockers.length > 0);

  private readonly fallbackScenario: ReleaseScenario = {
    id: 'unavailable',
    name: 'Release unavailable',
    date: '',
    previousReleaseId: '',
    score: 0,
    decision: 'AT RISK',
    summary: '',
    risks: [],
    gates: [],
    blockers: [],
    changes: []
  };

  constructor() {
    this.loadReleases();
  }

  private loadReleases(): void {
    this.isLoading.set(true);
    this.http.get<ApiRelease[] | { releases: ApiRelease[] }>(`${this.baseUrl}/api/releases`).subscribe({
      next: (response) => {
        const releases = Array.isArray(response) ? response : response.releases;
        const scenarios = releases.map((release) => this.toScenario(release));
        this.scenarios.set(scenarios);
        if (scenarios.length > 0) {
          const defaultReleaseId = scenarios[0].id;
          this.selectedId.set(defaultReleaseId);
          this.loadRelease(defaultReleaseId);
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.errorMessage.set('Unable to connect to the ReleaseGuard API.');
        this.isLoading.set(false);
      }
    });
  }

  private loadRelease(id: string): void {
    this.http.get<ApiRelease>(`${this.baseUrl}/api/releases/${id}`).subscribe({
      next: (release) => this.updateScenario(this.toScenario(release)),
      error: () => this.errorMessage.set('Unable to load the selected release.')
    });
  }

  private toScenario(release: ApiRelease): ReleaseScenario {
    const gates = release.gates ?? [];
    const blockers = release.blockers ?? gates.flatMap((gate) => gate.blockers ?? []);
    const score = release.score ?? gates.reduce((total, gate) => total + gate.score, 0);
    const decisionText = release.decision ?? (blockers.length ? 'AT RISK' : 'READY');
    return {
      id: String(release.id),
      name: release.name,
      date: release.releaseDate,
      previousReleaseId: release.previousReleaseId ?? '',
      score,
      decision: decisionText.toUpperCase(),
      summary: release.releaseSummary ?? '',
      risks: release.risks ?? [],
      gates: gates.map((gate) => ({
        name: gate.type.replaceAll('_', ' '),
        system: gate.type,
        icon: gate.type.charAt(0),
        status: this.toGateStatus(gate.status),
        score: gate.score,
        detail: gate.headline,
        metric: gate.findings?.length ? gate.findings.join(', ') : 'No findings'
      })),
      blockers,
      changes: release.changes ?? []
    };
  }

  private toGateStatus(status: string): GateStatus {
    const normalized = status.toUpperCase();
    return normalized === 'PASS' || normalized === 'READY' || normalized === 'RISK' || normalized === 'FAIL' ? normalized : 'RISK';
  }

  selectRelease(releaseId: string): void {
    this.selectedId.set(releaseId);
    this.showChanges.set(false);
    this.loadRelease(releaseId);
  }

  openSummary(): void {
    if (this.selected().summary) {
      this.showSummary.set(true);
      return;
    }

    this.analyze(true);
  }

  analyze(openSummary = false): void {
    const releaseId = this.selectedId();
    if (!releaseId) {
      return;
    }

    this.isAnalyzing.set(true);
    this.http.post<ApiReleaseResponse>(`${this.baseUrl}/api/releases/${releaseId}/analyze`, {}).pipe(
      finalize(() => this.isAnalyzing.set(false))
    ).subscribe({
      next: (response) => {
        const currentScenario = this.selected();
        const analyzedRelease = this.unwrapRelease(response, currentScenario);
        this.updateScenario(this.toScenario(analyzedRelease));
        if (openSummary) {
          this.showSummary.set(true);
        }
      },
      error: () => this.errorMessage.set('Release analysis failed.')
    });
  }

  private unwrapRelease(response: ApiReleaseResponse, currentScenario: ReleaseScenario): ApiRelease {
    const release = response.release ?? response.data ?? response.result ?? response;
    return {
      ...release,
      id: release.id ?? response.releaseId ?? currentScenario.id,
      name: release.name ?? currentScenario.name,
      releaseDate: release.releaseDate ?? currentScenario.date,
      previousReleaseId: release.previousReleaseId ?? currentScenario.previousReleaseId,
      gates: release.gates?.length ? release.gates : currentScenario.gates.map((gate) => ({
        type: gate.system,
        status: gate.status,
        score: gate.score,
        headline: gate.detail,
        findings: gate.metric === 'No findings' ? [] : [gate.metric],
        blockers: []
      })),
      changes: release.changes ?? currentScenario.changes,
      score: release.score ?? currentScenario.score,
      decision: release.decision ?? currentScenario.decision,
      blockers: release.blockers ?? currentScenario.blockers,
      releaseSummary: release.releaseSummary ?? response.releaseSummary ?? currentScenario.summary,
      risks: release.risks ?? response.risks ?? currentScenario.risks
    };
  }

  private updateScenario(scenario: ReleaseScenario): void {
    this.scenarios.update((scenarios) => scenarios.map((item) => item.id === scenario.id ? scenario : item));
  }

  toggleRollback(): void {
    this.showChanges.set(false);
    this.loadRelease(this.selectedId());
  }
}
