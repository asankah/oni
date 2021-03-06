import { remote } from "electron"
import * as fs from "fs"
import * as path from "path"

const BrowserWindow = remote.BrowserWindow

export interface IPluginMetadata {
    debugging: boolean
}

const DefaultMetadata: IPluginMetadata = {
    debugging: false,
}

const BrowserId = remote.getCurrentWindow().id

// Subscription Events
export const VimEventsSubscription = "vim-events"
export const BufferUpdateEvents = "buffer-update"

// Language Service Capabilities
export const FormatCapability = "formatting"
export const QuickInfoCapability = "quick-info"
export const GotoDefinitionCapability = "goto-definition"
export const CompletionProviderCapability = "completion-provider"
export const EvaluateBlockCapability = "evaluate-block"
export const SignatureHelpCapability = "signature-help"

export interface IEventContext {
    bufferFullPath: string
    line: number
    column: number
    byte: number
    filetype: string
}

export class Plugin {
    private _packageMetadata: any
    private _oniPluginMetadata: IPluginMetadata
    private _browserWindow: Electron.BrowserWindow
    private _browserWindowId: number
    private _webContents: any
    private _lastEventContext: IEventContext

    constructor(pluginRootDirectory: string, debugMode?: boolean) {
        const packageJsonPath = path.join(pluginRootDirectory, "package.json")

        if (fs.existsSync(packageJsonPath)) {
            this._packageMetadata = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))

            const engines = this._packageMetadata.engines

            // TODO: Handle oni engine version
            if (!engines || !engines["oni"]) { // tslint:disable-line no-string-literal
                console.warn("Aborting plugin load as Oni engine version not specified: " + packageJsonPath)
            } else {
                if (this._packageMetadata.main) {
                    const moduleEntryPoint = path.join(pluginRootDirectory, this._packageMetadata.main)
                    this._browserWindow = loadPluginInBrowser(moduleEntryPoint, null)
                    this._browserWindowId = this._browserWindow.id
                    this._webContents = this._browserWindow.webContents
                }

                const pluginMetadata = this._packageMetadata.oni || {}

                this._expandMultipleLanguageKeys(pluginMetadata)

                this._oniPluginMetadata = Object.assign({}, DefaultMetadata, pluginMetadata)

                if (this._oniPluginMetadata.debugging || debugMode) {
                    (<any> this._browserWindow).openDevTools()
                    this._browserWindow.show()
                }
            }
        }
    }

    public get browserWindow(): null | Electron.BrowserWindow {
        return this._browserWindow
    }

    public dispose(): void {
        if (this._browserWindow) {
            this._browserWindow.close()
            delete this._browserWindow
        }
    }

    public requestGotoDefinition(eventContext: IEventContext): void {
        this._send({
            type: "request",
            payload: {
                name: "goto-definition",
                context: eventContext,
            },
        })
    }

    public notifyBufferUpdateEvent(eventContext: IEventContext, bufferLines: string[]): void {
        this._send({
            type: "buffer-update",
            payload: {
                eventContext,
                bufferLines,
            },
        })
    }

    public requestCompletions(eventContext: IEventContext): void {
        this._send({
            type: "request",
            payload: {
                name: "completion-provider",
                context: eventContext,
            },
        })
    }

    public requestSignatureHelp(eventContext: IEventContext): void {
        this._send({
            type: "request",
            payload: {
                name: "signature-help",
                context: eventContext,
            },
        })
    }

    public requestQuickInfo(eventContext: IEventContext): void {
        this._send({
            type: "request",
            payload: {
                name: "quick-info",
                context: eventContext,
            },
        })
    }

    public requestFormat(eventContext: IEventContext): void {
        this._send({
            type: "request",
            payload: {
                name: "format",
                context: eventContext,
            },
        })
    }

    public requestEvaluateBlock(eventContext: IEventContext, id: string, fileName: string, code: string): void {
        this._send({
            type: "request",
            payload: {
                name: "evaluate-block",
                context: eventContext,
                id,
                code,
                fileName,
            },
        })
    }

    public notifyCompletionItemSelected(completionItem: any): void {
        // TODO: Only send to plugin that sent the request
        // TODO: Factor out to common 'sendRequest' method
        this._send({
            type: "request",
            payload: {
                name: "completion-provider-item-selected",
                context: this._lastEventContext,
                item: completionItem,
            },
        })
    }

    public notifyVimEvent(eventName: string, eventContext: IEventContext): void {
        this._lastEventContext = eventContext

        this._send({
            type: "event",
            payload: {
                name: eventName,
                context: eventContext,
            },
        })
    }

    public isPluginSubscribedToVimEvents(fileType: string): boolean {
        return this.isPluginSubscribedToEventType(fileType, VimEventsSubscription)
    }

    public isPluginSubscribedToBufferUpdates(fileType: string): boolean {
        return this.isPluginSubscribedToEventType(fileType, BufferUpdateEvents)
    }

    public isPluginSubscribedToEventType(fileType: string, oniEventName: string): boolean {
        if (!this._oniPluginMetadata) {
            return false
        }

        const filePluginInfo = this._oniPluginMetadata[fileType]

        return filePluginInfo && filePluginInfo.subscriptions && filePluginInfo.subscriptions.indexOf(oniEventName) >= 0
    }

    public doesPluginProvideLanguageServiceCapability(fileType: string, capability: string): boolean {
        if (!this._oniPluginMetadata) {
            return false
        }

        const filePluginInfo = this._oniPluginMetadata[fileType]

        return filePluginInfo && filePluginInfo.languageService && filePluginInfo.languageService.indexOf(capability) >= 0
    }

    /*
    * For blocks that handle multiple languages
    * ie, javascript,typescript
    * Split into separate language srevice blocks
    */
    private _expandMultipleLanguageKeys(packageMetadata: { [languageKey: string]: any }): void {
        Object.keys(packageMetadata).forEach((key) => {
            if (key.indexOf(",")) {
                const val = packageMetadata[key]
                key.split(",").forEach((splitKey) => {
                    packageMetadata[splitKey] = val
                })
            }
        })
    }

    private _send(message: any): void {
        if (!this.browserWindow) {
            return
        }

        // const messageToSend = Object.assign({}, message, {
        //     meta: {
        //         senderId: BrowserId,
        //         destinationId: this._browserWindowId
        //     }
        // })

        this._webContents.send("cross-browser-ipc", message)
    }
}

const loadPluginInBrowser = (pathToModule: string, _apiObject: any) => {
    const browserWindow = new BrowserWindow({ width: 10, height: 10, show: false, webPreferences: { webSecurity: false } })

    browserWindow.webContents.on("did-finish-load", () => {
        browserWindow.webContents.send("init", {
            pathToModule,
            sourceId: BrowserId,
        })
    })

    const url = "file://" + path.join(__dirname, "browser", "src", "Plugins", "plugin_host.html")
    browserWindow.loadURL(url)
    return browserWindow
}
