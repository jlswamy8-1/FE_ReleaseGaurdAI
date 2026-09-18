import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

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
  score: number;
  decision: string;
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
  gates: ApiGate[];
  changes?: string[];
  score?: number;
  decision?: string;
  blockers?: string[];
}

interface ApiDecision {
  decision?: string;
  status?: string;
  score?: number;
  blockers?: string[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
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
    score: 0,
    decision: 'AT RISK',
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
        this.scenarios.set(releases.map((release) => this.toScenario(release)));
        if (releases.length > 0) {
          this.selectedId.set(releases[0].id);
          this.loadRelease(releases[0].id);
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

  private toScenario(release: ApiRelease, decision?: ApiDecision): ReleaseScenario {
    const blockers = decision?.blockers ?? release.blockers ?? release.gates.flatMap((gate) => gate.blockers ?? []);
    const score = decision?.score ?? release.score ?? release.gates.reduce((total, gate) => total + gate.score, 0);
    const decisionText = decision?.decision ?? decision?.status ?? release.decision ?? (blockers.length ? 'AT RISK' : 'READY');
    return {
      id: release.id,
      name: release.name,
      date: release.releaseDate,
      score,
      decision: decisionText.toUpperCase(),
      gates: release.gates.map((gate) => ({
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

  selectRelease(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.selectedId.set(select.value);
    this.showChanges.set(false);
    this.loadRelease(select.value);
  }

  analyze(): void {
    this.isAnalyzing.set(true);
    this.http.post<ApiRelease>(`${this.baseUrl}/api/releases/${this.selectedId()}/analyze`, {}).subscribe({
      next: (release) => {
        this.http.get<ApiDecision>(`${this.baseUrl}/api/releases/${this.selectedId()}/decision`).subscribe({
          next: (decision) => this.updateScenario(this.toScenario(release, decision)),
          error: () => this.updateScenario(this.toScenario(release))
        });
      },
      error: () => {
        this.errorMessage.set('Release analysis failed.');
        this.isAnalyzing.set(false);
      }
    });
  }

  private updateScenario(scenario: ReleaseScenario): void {
    this.scenarios.update((scenarios) => scenarios.map((item) => item.id === scenario.id ? scenario : item));
    this.isAnalyzing.set(false);
  }

  toggleRollback(): void {
    this.showChanges.set(false);
    this.loadRelease(this.selectedId());
  }
}
