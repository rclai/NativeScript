﻿import common = require("./switch-common");
import dependencyObservable = require("ui/core/dependency-observable");
import proxy = require("ui/core/proxy");
import utils = require("utils/utils");
import viewModule = require("ui/core/view");

function onCheckedPropertyChanged(data: dependencyObservable.PropertyChangeData) {
    var swtch = <Switch>data.object;
    swtch.ios.on = data.newValue;
}

// register the setNativeValue callbacks
(<proxy.PropertyMetadata>common.Switch.checkedProperty.metadata).onSetNativeValue = onCheckedPropertyChanged;

global.moduleMerge(common, exports);

class SwitchChangeHandlerImpl extends NSObject {

    private _owner: WeakRef<Switch>;

    public static initWithOwner(owner: WeakRef<Switch>): SwitchChangeHandlerImpl {
        let handler = <SwitchChangeHandlerImpl>SwitchChangeHandlerImpl.new();
        handler._owner = owner;
        return handler;
    }

    public valueChanged(sender: UISwitch) {
        let owner = this._owner.get();
        if (owner) {
            owner._onPropertyChangedFromNative(common.Switch.checkedProperty, sender.on);
        }
    }

    public static ObjCExposedMethods = {
        'valueChanged': { returns: interop.types.void, params: [UISwitch] }
    };
}

export class Switch extends common.Switch {
    private _ios: UISwitch;
    private _handler: NSObject;

    constructor() {
        super();
        this._ios = new UISwitch();

        this._handler = SwitchChangeHandlerImpl.initWithOwner(new WeakRef(this));
        this._ios.addTargetActionForControlEvents(this._handler, "valueChanged", UIControlEvents.UIControlEventValueChanged);
    }

    get ios(): UISwitch {
        return this._ios;
    }

    public onMeasure(widthMeasureSpec: number, heightMeasureSpec: number): void {
        // It can't be anything different from 51x31
        let nativeSize = this._nativeView.sizeThatFits(CGSizeMake(0, 0));
        this.width = nativeSize.width;
        this.height = nativeSize.height;
        let widthAndState = utils.layout.makeMeasureSpec(nativeSize.width, utils.layout.EXACTLY);
        let heightAndState = utils.layout.makeMeasureSpec(nativeSize.height, utils.layout.EXACTLY);
        this.setMeasuredDimension(widthAndState, heightAndState);
    }
} 
