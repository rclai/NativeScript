import view = require("ui/core/view");
import types = require("utils/types");
import definition = require("ui/builder/component-builder");
import fs = require("file-system");
import bindingBuilder = require("./binding-builder");
import platform = require("platform");
import pages = require("ui/page");
import debug = require("utils/debug");

//the imports below are needed for special property registration
import "ui/layouts/dock-layout";
import "ui/layouts/grid-layout";
import "ui/layouts/absolute-layout";

import {getSpecialPropertySetter} from "ui/builder/special-properties";

var UI_PATH = "ui/";
var MODULES = {
    "TabViewItem": "ui/tab-view",
    "FormattedString": "text/formatted-string",
    "Span": "text/span",
    "ActionItem": "ui/action-bar",
    "NavigationButton": "ui/action-bar",
    "SegmentedBarItem": "ui/segmented-bar",
};

export function getComponentModule(elementName: string, namespace: string, attributes: Object, exports: Object): definition.ComponentModule {
    return getComponentModuleTemplate(elementName, namespace, <any>attributes, exports)();
}

function getComponentModuleTemplate(elementName: string, namespace: string, attributes: Attributes, exports: Object): () => definition.ComponentModule {
    var factory = new ComponentFactory(elementName, namespace, attributes, exports);
    return factory.create.bind(factory);
}

interface ViewConstructor {
    new (): view.View
}

interface ComponentSource {
    instanceType: ViewConstructor;
    instanceModule: Object;
}

interface Attributes {
    codeFile?: string;
    cssFile?: string;
    [key: string]: string;
}

class ComponentFactory {
    
    private _elementName: string;
    private _namespace: string;
    private _attributes: Attributes;
    private _exports: Object;
    
    // Resolved from elementName and namespace.
    private _componentSource: ComponentSource;
    
    constructor(elementName: string, namespace: string, attributes: Attributes, exports: Object) {
        this._elementName = elementName;
        this._namespace = namespace;
        this._attributes = attributes;
        this._exports = exports;    
    }
    
    private get componentSource(): ComponentSource {
        return this._componentSource || this.resolveComponentSource();
    }
    
    public create(): definition.ComponentModule {
        var componentSource = this.componentSource;
        
        // Create instance of the component.
        let instance: view.View = new componentSource.instanceType();
        
        this.applyAttributes(instance);
    
        if (instance && componentSource.instanceModule) {
            return { component: instance, exports: componentSource.instanceModule };
        }
        
        return null;
    }
    
    private resolveComponentSource(): ComponentSource {
        var instanceType: ViewConstructor;
        var instanceModule: Object;
        
        // Support lower-case-dashed component declaration in the XML (https://github.com/NativeScript/NativeScript/issues/309).
        var elementName = this._elementName.split("-").map(s => { return s[0].toUpperCase() + s.substring(1) }).join("");
        var namespace = this._namespace;
        
        // Get module id.
        var moduleId = MODULES[elementName] || UI_PATH +
            (elementName.toLowerCase().indexOf("layout") !== -1 ? "layouts/" : "") +
            elementName.split(/(?=[A-Z])/).join("-").toLowerCase();
    
        try {
            if (types.isString(namespace)) {
                var pathInsideTNSModules = fs.path.join(fs.knownFolders.currentApp().path, "tns_modules", namespace);
    
                if (fs.Folder.exists(pathInsideTNSModules)) {
                    moduleId = pathInsideTNSModules;
                } else {
                    // We expect module at root level in the app.
                    moduleId = fs.path.join(fs.knownFolders.currentApp().path, namespace);
                }
            }
    
            // Require module by module id.
            instanceModule = require(moduleId);
    
            // Get the component type from module.
            instanceType = instanceModule[elementName] || Object;
            
        } catch (ex) {
            throw new debug.ScopeError(ex, "Module '" + moduleId + "' not found for element '" + (namespace ? namespace + ":" : "") + elementName + "'.");
        }
        
        // TODO: Consider componentSource cache.
        this._componentSource = { instanceModule: instanceModule, instanceType: instanceType };
        return this._componentSource;
    }
    
    private applyAttributes(instance: view.View) {
        if (!instance || !this._attributes) {
            return 
        }
        
        var exports = this._exports;
        
        if (this._attributes.codeFile) {
            if (instance instanceof pages.Page) {
                var codeFilePath = this._attributes.codeFile.trim();
                if (codeFilePath.indexOf("~/") === 0) {
                    codeFilePath = fs.path.join(fs.knownFolders.currentApp().path, codeFilePath.replace("~/", ""));
                }
                try {
                    exports = require(codeFilePath);
                    (<any>instance).exports = exports;
                } catch (ex) {
                    throw new Error(`Code file with path "${codeFilePath}" cannot be found!`);
                }
            } else {
                throw new Error("Code file atribute is valid only for pages!");
            }
        }
    
        if (this._attributes.cssFile) {
            if (instance instanceof pages.Page) {
                var cssFilePath = this._attributes.cssFile.trim();
                if (cssFilePath.indexOf("~/") === 0) {
                    cssFilePath = fs.path.join(fs.knownFolders.currentApp().path, cssFilePath.replace("~/", ""));
                }
                if (fs.File.exists(cssFilePath)) {
                    (<pages.Page>instance).addCssFile(cssFilePath);
                    (<any>instance).cssFile = true;
                } else {
                    throw new Error(`Css file with path "${cssFilePath}" cannot be found!`);
                }
            } else {
                throw new Error("Css file atribute is valid only for pages!");
            }
        }
    
        for (var attr in this._attributes) {
    
            var attrValue = <string>this._attributes[attr];
    
            if (attr.indexOf(":") !== -1) {
                var platformName = attr.split(":")[0].trim();
                if (platformName.toLowerCase() === platform.device.os.toLowerCase()) {
                    attr = attr.split(":")[1].trim();
                } else {
                    continue;
                }
            }
    
            if (attr.indexOf(".") !== -1) {
                var subObj = instance;
                var properties = attr.split(".");
                var subPropName = properties[properties.length - 1];
    
                var i: number;
                for (i = 0; i < properties.length - 1; i++) {
                    if (types.isDefined(subObj)) {
                        subObj = subObj[properties[i]];
                    }
                }
    
                if (types.isDefined(subObj)) {
                    setPropertyValue2(subObj, exports, subPropName, attrValue);
                }
            } else {
                setPropertyValue2(instance, exports, attr, attrValue);
            }
        }
    }
}

export function setPropertyValue(instance: view.View, instanceModule: Object, exports: Object, propertyName: string, propertyValue: string) {
    // Note: instanceModule can be null if we are loading custom compnenet with no code-behind.
    setPropertyValue2(instance, exports, propertyName, propertyValue);
}

function setPropertyValue2(instance: view.View, exports: Object, propertyName: string, propertyValue: string) {
    
    if (isBinding(propertyValue) && instance.bind) {
        var bindOptions = bindingBuilder.getBindingOptions(propertyName, getBindingExpressionFromAttribute(propertyValue));
        instance.bind({
            sourceProperty: bindOptions[bindingBuilder.bindingConstants.sourceProperty],
            targetProperty: bindOptions[bindingBuilder.bindingConstants.targetProperty],
            expression: bindOptions[bindingBuilder.bindingConstants.expression],
            twoWay: bindOptions[bindingBuilder.bindingConstants.twoWay]
        }, bindOptions[bindingBuilder.bindingConstants.source]);
        return;
    }
    
    if (view.isEventOrGesture(propertyName, instance)) {
        // Get the event handler from page module exports.
        var handler = exports && exports[propertyValue];

        // Check if the handler is function and add it to the instance for specified event name.
        if (types.isFunction(handler)) {
            instance.on(propertyName, handler);
        }
        return;
    }
   
    let specialSetter = getSpecialPropertySetter(propertyName);
    if (specialSetter) {
        specialSetter(instance, propertyValue);
        return;
    }
    
    if ((<any>instance)._applyXmlAttribute && (<any>instance)._applyXmlAttribute(propertyName, propertyValue)) {
        return;
    }
    
    if (propertyValue.trim() === "") {
        instance[propertyName] = propertyValue;
        return;
    }
    
    // Try to convert value to number.
    var valueAsNumber = +propertyValue;
    if (!isNaN(valueAsNumber)) {
        instance[propertyName] = valueAsNumber;
        return;
    }
    
    if (propertyValue && (propertyValue.toLowerCase() === "true" || propertyValue.toLowerCase() === "false")) {
        instance[propertyName] = propertyValue.toLowerCase() === "true" ? true : false;
        return;
    }
    
    instance[propertyName] = propertyValue;
}

function getBindingExpressionFromAttribute(value: string): string {
    return value.replace("{{", "").replace("}}", "").trim();
}

function isBinding(value: string): boolean {
    var isBinding;

    if (types.isString(value)) {
        var str = value.trim();
        isBinding = str.indexOf("{{") === 0 && str.lastIndexOf("}}") === str.length - 2;
    }

    return isBinding;
}
