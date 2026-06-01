import {
  type PreflightController,
  type PreflightState,
  type ProctoringSignal,
} from "@proctoring/proctoring-sdk";
import { useEffect, useState } from "react";

export interface UsePreflight {
  state: PreflightState;
  environment: PreflightController["environment"];
  ready: boolean;
  request: (signal: ProctoringSignal) => void;
}

/**
 * Binds a {@link PreflightController} to React state. The controller owns the
 * media streams and permission logic (it lives in the framework-agnostic SDK);
 * this hook just re-renders on its state changes and forwards request actions.
 * Streams are released when the component unmounts.
 */
export function usePreflight(controller: PreflightController): UsePreflight {
  const [state, setState] = useState<PreflightState>(() =>
    controller.getState(),
  );

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  const request = (signal: ProctoringSignal): void => {
    if (signal === "camera") {
      void controller.requestCamera();
    } else if (signal === "microphone") {
      void controller.requestMicrophone();
    } else {
      void controller.requestScreen();
    }
  };

  return {
    state,
    environment: controller.environment,
    ready: state.ready,
    request,
  };
}
