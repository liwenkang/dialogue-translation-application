import { app } from "electron";
import os from "os";

interface PerformanceSnapshot {
  timestamp: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  };
  cpuUsage: {
    user: number;
    system: number;
  };
  systemInfo: {
    platform: string;
    arch: string;
    cpuModel: string;
    cpuCores: number;
    totalMemory: number;
    freeMemory: number;
  };
}

interface TimingRecord {
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

export class PerformanceService {
  private timings: TimingRecord[] = [];
  private snapshots: PerformanceSnapshot[] = [];
  private startupTime: number;

  constructor() {
    this.startupTime = Date.now();
  }

  startTimer(operation: string): () => number {
    const record: TimingRecord = {
      operation,
      startTime: Date.now(),
    };
    this.timings.push(record);

    return () => {
      record.endTime = Date.now();
      record.duration = record.endTime - record.startTime;
      return record.duration;
    };
  }

  takeSnapshot(label?: string): PerformanceSnapshot {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const cpus = os.cpus();

    const snapshot: PerformanceSnapshot = {
      timestamp: Date.now(),
      memoryUsage: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        external: mem.external,
      },
      cpuUsage: {
        user: cpu.user / 1000, // Convert to ms
        system: cpu.system / 1000,
      },
      systemInfo: {
        platform: process.platform,
        arch: process.arch,
        cpuModel: cpus[0]?.model ?? "unknown",
        cpuCores: cpus.length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
      },
    };

    this.snapshots.push(snapshot);
    if (label) {
      console.log(
        `[perf:${label}] RSS: ${(mem.rss / 1024 / 1024).toFixed(1)}MB, Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`,
      );
    }
    return snapshot;
  }

  getStartupDuration(): number {
    return Date.now() - this.startupTime;
  }

  getTimings(): TimingRecord[] {
    return this.timings.filter((t) => t.duration !== undefined);
  }

  getReport(): string {
    const snap = this.takeSnapshot("report");
    const completedTimings = this.getTimings();

    const report = {
      startup: {
        totalMs: this.getStartupDuration(),
      },
      currentMemory: {
        rssMB: +(snap.memoryUsage.rss / 1024 / 1024).toFixed(1),
        heapUsedMB: +(snap.memoryUsage.heapUsed / 1024 / 1024).toFixed(1),
        heapTotalMB: +(snap.memoryUsage.heapTotal / 1024 / 1024).toFixed(1),
        externalMB: +(snap.memoryUsage.external / 1024 / 1024).toFixed(1),
      },
      system: snap.systemInfo,
      operationTimings: completedTimings.map((t) => ({
        operation: t.operation,
        durationMs: t.duration,
      })),
    };

    return JSON.stringify(report, null, 2);
  }
}
