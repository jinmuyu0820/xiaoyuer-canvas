import type { ProjectSnapshotDocument } from '@/core/projects/project-snapshot';
import { applyCanvasOperations, type CanvasOperation } from './canvas-commands';
import { BeatDesignCommandError, createCommandFailure, createCommandSuccess, type BeatDesignCommandEnvelope, type BeatDesignCommandResult } from './contracts';

export type BeatDesignCommand = { type: 'canvas.apply'; operations: CanvasOperation[] };
export type BeatDesignCommandDocuments = { canvas?: ProjectSnapshotDocument };
export type BeatDesignCommandData = BeatDesignCommandDocuments;

export function executeBeatDesignCommand({ envelope, documents }: {
  envelope: BeatDesignCommandEnvelope<BeatDesignCommand>;
  documents: BeatDesignCommandDocuments;
}): BeatDesignCommandResult<BeatDesignCommandData> {
  const { commandId, projectId, origin, command } = envelope;
  try {
    if (command.type !== 'canvas.apply') throw new BeatDesignCommandError('INVALID_COMMAND', 'Only Canvas commands are supported.');
    if (!documents.canvas) throw new BeatDesignCommandError('NOT_FOUND', 'Canvas document was not found.');
    const applied = applyCanvasOperations(documents.canvas, command.operations);
    return createCommandSuccess({ commandId, projectId, origin, changedIds: applied.changedIds, data: { canvas: applied.document } });
  } catch (error) {
    return createCommandFailure({ commandId, projectId, origin,
      code: error instanceof BeatDesignCommandError ? error.code : 'COMMAND_FAILED',
      message: error instanceof Error ? error.message : 'The command could not be applied.',
    });
  }
}
