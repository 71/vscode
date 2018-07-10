/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { IConfigurationChangedEvent } from 'vs/editor/common/config/editorOptions';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { IDisposable } from 'vs/base/common/lifecycle';
import { ITerminalService, ITerminalInstance } from 'vs/workbench/parts/terminal/common/terminal';
import { isNullOrUndefined } from 'util';

export class FocusOnHoverController implements IEditorContribution {

	// A single instance of the controller manages a single editor.
	// However, since terminals are shared, only a single instance must take care of terminals.
	private static readonly ID = 'editor.contrib.focusOnHover';
	private static readonly Instances: FocusOnHoverController[] = [];

	private readonly _didChangeConfigurationHandler: IDisposable;

	private _editorMouseMoveHandler?: IDisposable;

	private _terminalHooks: Map<number, IDisposable>;
	private _terminalInstanceCreatedHandler?: IDisposable;
	private _terminalInstanceDisposedHandler?: IDisposable;

	static get(editor: ICodeEditor): FocusOnHoverController {
		return editor.getContribution<FocusOnHoverController>(FocusOnHoverController.ID);
	}

	constructor(private readonly _editor: ICodeEditor,
		@ITerminalService private readonly _terminals: ITerminalService) {

		this._didChangeConfigurationHandler = this._editor.onDidChangeConfiguration((e: IConfigurationChangedEvent) => {
			if (e.contribInfo) {
				this._unhookEvents();
				this._hookEvents();
			}
		});

		if (FocusOnHoverController.Instances.length === 0) {
			// There is no existing controller, which means that no one is taking care of the terminals.
			this._terminalHooks = new Map();
			this._handleTerminals();
		}

		this._hookEvents();
		FocusOnHoverController.Instances.push(this);
	}

	private _handleTerminals() {
		this._terminalInstanceCreatedHandler = this._terminals.onInstanceCreated(t => this._onTerminalCreated(t));
		this._terminalInstanceDisposedHandler = this._terminals.onInstanceDisposed(t => this._onTerminalDisposed(t));
	}

	private _onTerminalCreated(terminal: ITerminalInstance): void {
		if (this._editor.getConfiguration().contribInfo.focusOnHover) {
			this._terminalHooks[terminal.id] = terminal.onMouseMove(t => t.focus());
		}
	}

	private _onTerminalDisposed(terminal: ITerminalInstance): void {
		if (this._terminalHooks.has(terminal.id)) {
			this._terminalHooks[terminal.id].dispose();
			this._terminalHooks.delete(terminal.id);
		}
	}

	private get _manageTerminals(): boolean {
		return !isNullOrUndefined(this._terminalInstanceCreatedHandler);
	}

	private _hookEvents(): void {
		if (this._editor.getConfiguration().contribInfo.focusOnHover) {
			this._editorMouseMoveHandler = this._editor.onMouseMove(_ => this._onEditorMouseMove());

			if (this._manageTerminals) {
				for (const terminal of this._terminals.terminalInstances) {
					this._terminalHooks[terminal.id] = terminal.onMouseMove(t => t.focus());
				}
			}
		}
	}

	private _unhookEvents(): void {
		if (this._editorMouseMoveHandler) {
			this._editorMouseMoveHandler.dispose();
			this._editorMouseMoveHandler = null;

			if (this._manageTerminals) {
				for (const hook in this._terminalHooks) {
					this._terminalHooks[hook].dispose();
				}

				this._terminalHooks.clear();
			}
		}
	}

	private _onEditorMouseMove(): void {
		if (!this._editor.hasTextFocus()) {
			this._editor.focus();
		}
	}

	public getId(): string {
		return FocusOnHoverController.ID;
	}

	public dispose(): void {
		this._didChangeConfigurationHandler.dispose();

		const idx = FocusOnHoverController.Instances.indexOf(this);
		FocusOnHoverController.Instances.splice(idx, 1);

		if (this._terminalInstanceCreatedHandler) {
			// We're managing the terminals
			this._terminalInstanceCreatedHandler.dispose();
			this._terminalInstanceDisposedHandler.dispose();

			if (FocusOnHoverController.Instances.length > 0) {
				// We can give the ownership to another instance.
				const otherInstance = FocusOnHoverController.Instances[0];

				otherInstance._terminalHooks = this._terminalHooks;
				otherInstance._handleTerminals();

				this._terminalHooks = new Map();
			} else {
				// No one to take care of it, so we dispose everything
				for (const terminalId in this._terminalHooks) {
					this._terminalHooks[terminalId].dispose();
				}

				this._terminalHooks.clear();
			}
		}

		// Only unhook events AFTER all this, in order to avoid disposing terminal
		// hooks instead of moving them to another instance.
		this._unhookEvents();
	}
}

registerEditorContribution(FocusOnHoverController);
