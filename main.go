package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/src
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:     "Mdmuder",
		Width:     1360,
		Height:    860,
		MinWidth:  900,
		MinHeight: 560,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: &localFileHandler{app: app},
		},
		BackgroundColour: &options.RGBA{R: 235, G: 240, B: 236, A: 1},
		OnStartup:        app.startup,
		OnDomReady:       app.domReady,
		OnBeforeClose:    app.beforeClose,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		Windows: &windows.Options{
			Theme:               windows.SystemDefault,
			BackdropType:        windows.None,
			ResizeDebounceMS:    8,
			DisablePinchZoom:    false,
			EnableSwipeGestures: false,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
