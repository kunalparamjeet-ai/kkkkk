import React, { useEffect, useRef, useState } from 'react';
import {
  FileCode,
  Lightbulb,
  Loader2,
  Mic,
  MicOff,
  MousePointerClick,
  Plus,
  Send,
  Sparkles,
  Square,
  Target,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api.ts';

export interface AttachedFileSnippet {
  name: string;
  content: string;
  size: number;
}

export interface SelectedTargetInfo {
  selector: string;
  label: string;
}

interface WorkspaceComposerProps {
  projectId: string | null;
  promptText: string;
  onPromptChange: (val: string) => void;
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  models: Array<{ id: string; displayName: string; available: boolean }>;
  isJobRunning: boolean;
  hasPreviewOpen: boolean;
  elementSelectMode: boolean;
  onToggleElementSelectMode: () => void;
  selectedTarget: SelectedTargetInfo | null;
  onSelectTarget: (target: SelectedTargetInfo | null) => void;
  attachments: AttachedFileSnippet[];
  onAddAttachments: (files: AttachedFileSnippet[]) => void;
  onRemoveAttachment: (name: string) => void;
  onSubmitPrompt: () => void;
  onStopJob: () => void;
  compact?: boolean;
}

const QUICK_UI_TARGETS: SelectedTargetInfo[] = [
  { selector: 'header, nav', label: 'Top Navigation Bar' },
  { selector: 'section.hero, main > section:first-child', label: 'Hero Section' },
  { selector: '.kpi-grid, .cards-grid', label: 'Metrics & Cards Grid' },
  { selector: 'form, .auth-card', label: 'Form & Inputs' },
  { selector: 'table, .data-table', label: 'Data Table / List' },
  { selector: 'footer', label: 'Footer' },
];

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionInstanceLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function WorkspaceComposer({
  projectId,
  promptText,
  onPromptChange,
  selectedModelId,
  onModelChange,
  models,
  isJobRunning,
  hasPreviewOpen,
  elementSelectMode,
  onToggleElementSelectMode,
  selectedTarget,
  onSelectTarget,
  attachments,
  onAddAttachments,
  onRemoveAttachment,
  onSubmitPrompt,
  onStopJob,
  compact = false,
}: WorkspaceComposerProps) {
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [pointerMenuOpen, setPointerMenuOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [refiningPrompt, setRefiningPrompt] = useState(false);

  const [listening, setListening] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null);
  const basePromptRef = useRef<string>('');

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const loaded: AttachedFileSnippet[] = [];
    for (const file of Array.from(fileList).slice(0, 6)) {
      try {
        const text = await file.text();
        loaded.push({
          name: file.name,
          content: text.slice(0, 12000),
          size: file.size,
        });
      } catch {
        // ignore unreadable binary
      }
    }
    if (loaded.length > 0) {
      onAddAttachments(loaded);
    }
    e.target.value = '';
    setPlusMenuOpen(false);
  };

  const handleToggleVoice = () => {
    setVoiceNotice(null);
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstanceLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstanceLike;
    };
    const SpeechCtor = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechCtor) {
      setVoiceNotice('Voice dictation requires Chrome, Edge, or Safari speech recognition support.');
      return;
    }

    try {
      const recognition = new SpeechCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      basePromptRef.current = promptText.trim();

      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0]?.transcript || '';
        }
        const combined = [basePromptRef.current, transcript.trim()].filter(Boolean).join(' ');
        onPromptChange(combined);
      };

      recognition.onerror = (evt) => {
        setListening(false);
        if (evt?.error === 'not-allowed') {
          setVoiceNotice('Microphone permission was denied in this browser.');
        } else {
          setVoiceNotice(`Voice input stopped (${evt?.error || 'unavailable'}).`);
        }
      };

      recognition.onend = () => {
        setListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
      setVoiceNotice('Could not access microphone in this browser environment.');
    }
  };

  const handleOpenSuggestions = async () => {
    const nextOpen = !suggestionsOpen;
    setSuggestionsOpen(nextOpen);
    setPlusMenuOpen(false);
    setPointerMenuOpen(false);
    if (!nextOpen) return;

    setLoadingSuggestions(true);
    try {
      const res = await apiRequest<{ suggestions: string[] }>('/api/projects/suggest', {
        method: 'POST',
        body: JSON.stringify({ projectId, prompt: promptText }),
      });
      setSuggestions(res.suggestions || []);
    } catch {
      setSuggestions([
        'Build a clean analytics dashboard with 14-day KPI charts and search filters',
        'Add responsive mobile layout, accessible buttons, and dark/light theme support',
      ]);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const handleRefinePrompt = async () => {
    if (!promptText.trim() || refiningPrompt) return;
    setRefiningPrompt(true);
    try {
      const res = await apiRequest<{ refinedPrompt?: string }>('/api/projects/suggest', {
        method: 'POST',
        body: JSON.stringify({ projectId, prompt: promptText, mode: 'refine' }),
      });
      if (res.refinedPrompt) {
        onPromptChange(res.refinedPrompt);
      }
      setSuggestionsOpen(false);
    } catch {
      // keep current prompt
    } finally {
      setRefiningPrompt(false);
    }
  };

  const handlePointerClick = () => {
    setPlusMenuOpen(false);
    setSuggestionsOpen(false);
    if (hasPreviewOpen) {
      onToggleElementSelectMode();
      setPointerMenuOpen(false);
    } else {
      setPointerMenuOpen((v) => !v);
    }
  };

  return (
    <div className="relative">
      {/* Hidden File Input for Plus (+) Button */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".html,.css,.js,.ts,.tsx,.jsx,.json,.md,.txt,.svg,.csv"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* AI Suggestions Popover (Lightbulb) */}
      {suggestionsOpen && (
        <div className="absolute bottom-full left-0 right-0 mb-2 z-30 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-3 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
              <span>AI Prompt Suggestions &amp; Assistance</span>
            </span>
            <button
              type="button"
              onClick={() => setSuggestionsOpen(false)}
              className="p-1 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {promptText.trim().length > 2 && (
            <button
              type="button"
              onClick={() => void handleRefinePrompt()}
              disabled={refiningPrompt}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/60 cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5">
                {refiningPrompt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span>{refiningPrompt ? 'Refining prompt...' : 'Enhance my current prompt with layout & UX details'}</span>
              </span>
            </button>
          )}

          {loadingSuggestions ? (
            <div className="py-4 text-center text-xs text-zinc-500">Loading suggestions...</div>
          ) : (
            <div className="grid grid-cols-1 gap-1.5">
              {suggestions.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    onPromptChange(s);
                    setSuggestionsOpen(false);
                  }}
                  className="text-left px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-xs text-zinc-700 dark:text-zinc-200 cursor-pointer transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pointer Target Menu (when preview is not yet open) */}
      {pointerMenuOpen && !hasPreviewOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-72 z-30 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-2.5 space-y-1.5">
          <div className="flex items-center justify-between px-1 pb-1 border-b border-zinc-100 dark:border-zinc-800">
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              Select Target Component
            </span>
            <button
              type="button"
              onClick={() => setPointerMenuOpen(false)}
              className="text-zinc-400 hover:text-zinc-700 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {QUICK_UI_TARGETS.map((t) => (
            <button
              key={t.selector}
              type="button"
              onClick={() => {
                onSelectTarget(t);
                setPointerMenuOpen(false);
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-between cursor-pointer"
            >
              <span>{t.label}</span>
              <span className="font-mono text-[10px] text-zinc-400">{t.selector.split(',')[0]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Plus (+) Menu */}
      {plusMenuOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-64 z-30 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl p-1.5 space-y-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <FileCode className="w-3.5 h-3.5 text-blue-600" />
            <span>Upload files to project &amp; prompt</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPlusMenuOpen(false);
              setPointerMenuOpen(true);
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <Target className="w-3.5 h-3.5 text-zinc-500" />
            <span>Focus a specific UI component</span>
          </button>
        </div>
      )}

      {/* Main Composer Card */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!promptText.trim() || isJobRunning) return;
          onSubmitPrompt();
        }}
        className="rounded-2xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm focus-within:border-blue-600 dark:focus-within:border-blue-500 transition-colors"
      >
        {/* Active Context Chips (Attachments, Visual Target, Voice Notice) */}
        {(attachments.length > 0 || selectedTarget || elementSelectMode || voiceNotice || listening) && (
          <div className="px-3.5 pt-2.5 flex flex-wrap items-center gap-1.5">
            {elementSelectMode && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                <MousePointerClick className="w-3 h-3" />
                <span>Click any element in the live preview to target it</span>
              </span>
            )}
            {selectedTarget && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-[11px] font-mono text-blue-700 dark:text-blue-300">
                <Target className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[200px]">{selectedTarget.label}</span>
                <button
                  type="button"
                  onClick={() => onSelectTarget(null)}
                  className="hover:text-blue-950 dark:hover:text-white cursor-pointer"
                  aria-label="Remove target"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {attachments.map((att) => (
              <span
                key={att.name}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[11px] font-mono text-zinc-700 dark:text-zinc-200"
              >
                <FileCode className="w-3 h-3 text-blue-600 shrink-0" />
                <span className="truncate max-w-[140px]">{att.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.name)}
                  className="text-zinc-400 hover:text-red-600 cursor-pointer"
                  aria-label={`Remove ${att.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            {listening && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[11px] font-medium text-red-600 dark:text-red-300">
                <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" />
                <span>Listening... speak your prompt</span>
              </span>
            )}
            {voiceNotice && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-[11px] text-amber-800 dark:text-amber-200">
                <span>{voiceNotice}</span>
                <button type="button" onClick={() => setVoiceNotice(null)} className="cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>
        )}

        <textarea
          rows={compact ? 2 : 3}
          value={promptText}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (promptText.trim() && !isJobRunning) {
                onSubmitPrompt();
              }
            }
          }}
          placeholder="Tell VEKTOR AI what to build, redesign, or modify..."
          className="w-full resize-none px-4 pt-3.5 pb-2 text-sm bg-transparent text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none"
        />

        {/* Bottom Control Bar Inside Input Box: (+), (Pointer), (Lightbulb), Model Select, (Mic), (Send/Stop) */}
        <div className="px-3 pb-2.5 pt-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {/* 1. Plus (+) attachment/upload button */}
            <button
              type="button"
              onClick={() => {
                setPlusMenuOpen((v) => !v);
                setPointerMenuOpen(false);
                setSuggestionsOpen(false);
              }}
              title="Attach files or upload code"
              aria-label="Attachments and uploads"
              className={`p-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                plusMenuOpen
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-600'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Plus className="w-4 h-4" />
            </button>

            {/* 2. Mouse Pointer button (Visual Element Picker / Component Focus) */}
            <button
              type="button"
              onClick={handlePointerClick}
              title={
                hasPreviewOpen
                  ? 'Inspect & select an element in the live preview'
                  : 'Select a target UI section to focus'
              }
              aria-label="Select UI element target"
              className={`p-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                elementSelectMode || pointerMenuOpen
                  ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <MousePointerClick className="w-4 h-4" />
            </button>

            {/* 3. Lightbulb button (AI Suggestions & Prompt Refiner) */}
            <button
              type="button"
              onClick={() => void handleOpenSuggestions()}
              title="AI prompt suggestions and prompt enhancer"
              aria-label="AI suggestions and assistance"
              className={`p-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                suggestionsOpen
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Lightbulb className="w-4 h-4" />
            </button>

            {/* Compact Model Selector */}
            <select
              aria-label="Model Routing"
              value={selectedModelId}
              onChange={(e) => onModelChange(e.target.value)}
              className="ml-1 text-[11px] px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-200 max-w-[165px] focus:outline-none"
            >
              <option value="vektor-auto">VEKTOR Auto-Orchestrate</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} {m.available ? '' : '(Unconfigured)'}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            {/* 4. Microphone button (Voice Input) */}
            <button
              type="button"
              onClick={handleToggleVoice}
              title={listening ? 'Stop voice dictation' : 'Start voice input'}
              aria-label="Voice input"
              className={`p-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                listening
                  ? 'border-red-500 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            {/* 5. Send / Stop Button */}
            {isJobRunning ? (
              <button
                type="button"
                onClick={onStopJob}
                title="Stop generation"
                aria-label="Stop generation"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium cursor-pointer transition-colors"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!promptText.trim()}
                title="Send prompt"
                aria-label="Send prompt"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium disabled:opacity-40 cursor-pointer transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
