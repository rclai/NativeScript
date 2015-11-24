﻿import view = require("ui/core/view");
import fs = require("file-system");
import xml = require("xml");
import types = require("utils/types");
import componentBuilder = require("ui/builder/component-builder");
import templateBuilderDef = require("ui/builder/template-builder");
import platform = require("platform");
import definition = require("ui/builder");
import page = require("ui/page");
import fileResolverModule = require("file-system/file-name-resolver");
import trace = require("trace");
import debug = require("utils/debug");

var KNOWNCOLLECTIONS = "knownCollections";

function isPlatform(value: string): boolean {
    return value && (value.toLowerCase() === platform.platformNames.android.toLowerCase()
        || value.toLowerCase() === platform.platformNames.ios.toLowerCase());
}

function isCurentPlatform(value: string): boolean {
    return value && value.toLowerCase() === platform.device.os.toLowerCase();
}

export function parse(value: string | view.Template, context: any): view.View {
    if (types.isString(value)) {
        var viewToReturn: view.View;
    
        if (context instanceof view.View) {
            context = getExports(context);
        }
    
        var componentModule = parseInternal(<string>value, context);
    
        if (componentModule) {
            viewToReturn = componentModule.component;
        }
    
        return viewToReturn;
    } else if (types.isFunction(value)) {
        return (<view.Template>value)();
    }
}

function parseInternal(value: string, context: any, uri?: string): componentBuilder.ComponentModule {
    
    var start: xml2ui.XmlStringParser;
    var ui: xml2ui.UIParser;
    
    var errorFormat = (debug.debug && uri) ? xml2ui.SourceErrorFormat(uri) : xml2ui.PositionErrorFormat;
    
    (start = new xml2ui.XmlStringParser(errorFormat))
        .pipe(new xml2ui.PlatformFilter())
        .pipe(ui = new xml2ui.UIParser(context));

    start.parseString(value);

    return ui.rootComponentModule;
}

namespace xml2ui {
    
    export class XmlStream {
        private next: XmlStream;
        
        public pipe<Next extends XmlStream>(next: Next): Next {
            this.next = next;
            return next;
        }
        
        public parse(args: xml.ParserEvent): XmlStream {
            this.next = this.next.parse(args);
            return this;
        }
    }
    
    export class XmlStringParser extends XmlStream {
        private error: ErrorFormatter;
        
        constructor(error?: ErrorFormatter) {
            super();
            this.error = error || PositionErrorFormat;
        }
        
        public parseString(value: string) {
            var xmlParser = new xml.XmlParser((args: xml.ParserEvent) => {
                try {
                    super.parse(args);
                } catch(e) {
                    throw this.error(e, args.position);
                }
            }, (e, p) => {
                throw this.error(e, p);
            }, true);
            
            if (types.isString(value)) {
                value = value.replace(/xmlns=("|')http:\/\/((www)|(schemas))\.nativescript\.org\/tns\.xsd\1/, "");
                xmlParser.parse(value);
            }
        }
    }
    
    interface ErrorFormatter {
        (e: Error, p: xml.Position): Error;
    }
    
    export function PositionErrorFormat(e: Error, p: xml.Position): Error {
        return new debug.ScopeError(e, "Parsing XML at " + p.line + ":" + p.column);
    }
    
    export function SourceErrorFormat(uri): ErrorFormatter {
        return (e: Error, p: xml.Position) => {
            var source = new debug.Source(uri, p.line, p.column);
            e = new debug.SourceError(e, source, "Building UI from XML.");
            return e;
        }
    }
    
    export class PlatformFilter extends XmlStream {
        private currentPlatformContext: string;
        
        public parse(args: xml.ParserEvent): XmlStream {
           if (args.eventType === xml.ParserEventType.StartElement) {
                if (isPlatform(args.elementName)) {
    
                    if (this.currentPlatformContext) {
                        throw new Error("Already in '" + this.currentPlatformContext + "' platform context and cannot switch to '" + args.elementName + "' platform! Platform tags cannot be nested.");
                    }
    
                    this.currentPlatformContext = args.elementName;
                    return this;
                }
            }
    
            if (args.eventType === xml.ParserEventType.EndElement) {
                if (isPlatform(args.elementName)) {
                    this.currentPlatformContext = undefined;
                    return this;
                }
            }
    
            if (this.currentPlatformContext && !isCurentPlatform(this.currentPlatformContext)) {
                return this;
            }
            
            return super.parse(args);
        }
    }
    
    export class TemplateParser extends XmlStream {
        
        private templateBuilder: templateBuilderDef.TemplateBuilder;
        private previous: XmlStream;
        
        constructor(previous: XmlStream, template: templateBuilderDef.TemplateProperty) {
            super();
            this.previous = previous;
            this.templateBuilder = new templateBuilderDef.TemplateBuilder(template);
        }
        
        public parse(args: xml.ParserEvent): XmlStream {
            if (this.templateBuilder.handleElement(args)) {
                return this.previous;
            } else {
                return this;
            }
        }
    }
    
    export class UIParser extends XmlStream {
        
        public rootComponentModule: componentBuilder.ComponentModule;
        
        private context: any;
        
        private currentPage: page.Page;
        private parents = new Array<componentBuilder.ComponentModule>();
        private complexProperties = new Array<ComplexProperty>();

        constructor(context: any) {
            super();
            this.context = context;
        }
    
        public parse(args: xml.ParserEvent): XmlStream {
    
            // Get the current parent.
            var parent = this.parents[this.parents.length - 1];
            var complexProperty = this.complexProperties[this.complexProperties.length - 1];
    
            // Create component instance from every element declaration.
            if (args.eventType === xml.ParserEventType.StartElement) {
                if (isComplexProperty(args.elementName)) {
    
                    var name = getComplexProperty(args.elementName);
    
                    this.complexProperties.push({
                        parent: parent,
                        name: name,
                        items: [],
                    });
    
                    if (templateBuilderDef.isKnownTemplate(name, parent.exports)) {
                        return new TemplateParser(this, {
                            context: parent ? getExports(parent.component) : null, // Passing 'context' won't work if you set "codeFile" on the page
                            parent: parent,
                            name: name,
                            elementName: args.elementName,
                            templateItems: []
                        });
                    }
    
                } else {
    
                    var componentModule: componentBuilder.ComponentModule;
    
                    if (args.prefix && args.namespace) {
                        // Custom components
                        componentModule = loadCustomComponent(args.namespace, args.elementName, args.attributes, this.context, this.currentPage);
                    } else {
                        // Default components
                        componentModule = componentBuilder.getComponentModule(args.elementName, args.namespace, args.attributes, this.context);
                    }
    
                    if (componentModule) {
                        if (parent) {
                            if (complexProperty) {
                                // Add component to complex property of parent component.
                                addToComplexProperty(parent, complexProperty, componentModule);
                            } else if ((<any>parent.component)._addChildFromBuilder) {
                                (<any>parent.component)._addChildFromBuilder(args.elementName, componentModule.component);
                            }
                        } else if (this.parents.length === 0) {
                            // Set root component.
                            this.rootComponentModule = componentModule;
    
                            if (this.rootComponentModule && this.rootComponentModule.component instanceof page.Page) {
                                this.currentPage = <page.Page>this.rootComponentModule.component;
                            }
                        }
    
                        // Add the component instance to the parents scope collection.
                        this.parents.push(componentModule);
                    }
                }
    
            } else if (args.eventType === xml.ParserEventType.EndElement) {
                if (isComplexProperty(args.elementName)) {
                    if (complexProperty) {
                        if (parent && (<any>parent.component)._addArrayFromBuilder) {
                            // If parent is AddArrayFromBuilder call the interface method to populate the array property.
                            (<any>parent.component)._addArrayFromBuilder(complexProperty.name, complexProperty.items);
                            complexProperty.items = [];
                        }
                    }
                    // Remove the last complexProperty from the complexProperties collection (move to the previous complexProperty scope).
                    this.complexProperties.pop();
    
                } else {
                    // Remove the last parent from the parents collection (move to the previous parent scope).
                    this.parents.pop();
                }
            }
            
            return this;
        }
    }
}

function loadCustomComponent(componentPath: string, componentName?: string, attributes?: Object, context?: Object, parentPage?: page.Page): componentBuilder.ComponentModule {
    var result: componentBuilder.ComponentModule;
    componentPath = componentPath.replace("~/", "");

    var fullComponentPathFilePathWithoutExt = componentPath;

    if (!fs.File.exists(componentPath) || componentPath === "." || componentPath === "./") {
        fullComponentPathFilePathWithoutExt = fs.path.join(fs.knownFolders.currentApp().path, componentPath, componentName);
    }

    var xmlFilePath = fileResolverModule.resolveFileName(fullComponentPathFilePathWithoutExt, "xml");

    if (xmlFilePath) {
        // Custom components with XML
        var jsFilePath = fileResolverModule.resolveFileName(fullComponentPathFilePathWithoutExt, "js");

        var subExports;
        if (jsFilePath) {
            // Custom components with XML and code
            subExports = require(jsFilePath)
        }

        result = loadInternal(xmlFilePath, subExports);

        // Attributes will be transfered to the custom component
        if (types.isDefined(result) && types.isDefined(result.component) && types.isDefined(attributes)) {
            var attr: string;
            for (attr in attributes) {
                componentBuilder.setPropertyValue(result.component, subExports, context, attr, attributes[attr]);
            }
        }
    } else {
        // Custom components without XML
        result = componentBuilder.getComponentModule(componentName, componentPath, attributes, context);
    }

    // Add component CSS file if exists.
    var cssFilePath = fileResolverModule.resolveFileName(fullComponentPathFilePathWithoutExt, "css");
    if (cssFilePath) {
        if (parentPage) {
            parentPage.addCssFile(cssFilePath);
        } else {
            trace.write("CSS file found but no page specified. Please specify page in the options!", trace.categories.Error, trace.messageType.error);
        }
    }

    return result;
}

export function load(pathOrOptions: string | definition.LoadOptions, context?: any): view.View {
    var viewToReturn: view.View;
    var componentModule: componentBuilder.ComponentModule;

    if (!context) {
        if (!types.isString(pathOrOptions)) {
            let options = <definition.LoadOptions>pathOrOptions;
            componentModule = loadCustomComponent(options.path, options.name, undefined, options.exports, options.page);
        } else {
            let path = <string>pathOrOptions;
            componentModule = loadInternal(path);
        }
    } else {
        let path = <string>pathOrOptions;
        componentModule = loadInternal(path, context);
    }

    if (componentModule) {
        viewToReturn = componentModule.component;
    }

    return viewToReturn;
}

function loadInternal(fileName: string, context?: any): componentBuilder.ComponentModule {
    var componentModule: componentBuilder.ComponentModule;

    // Check if the XML file exists.
    if (fs.File.exists(fileName)) {
        var file = fs.File.fromPath(fileName);
        var onError = function (error) {
            throw new Error("Error loading file " + fileName + " :" + error.message);
        }
        var text = file.readTextSync(onError);
        componentModule = parseInternal(text, context, fileName);
    }

    if (componentModule && componentModule.component) {
        // Save exports to root component (will be used for templates).
        (<any>componentModule.component).exports = context;
    }

    return componentModule;
}

function isComplexProperty(name: string): boolean {
    return types.isString(name) && name.indexOf(".") !== -1;
}

function getComplexProperty(fullName: string): string {
    var name: string;

    if (types.isString(fullName)) {
        var names = fullName.split(".");
        name = names[names.length - 1];
    }

    return name;
}

function isKnownCollection(name: string, context: any): boolean {
    return KNOWNCOLLECTIONS in context && context[KNOWNCOLLECTIONS] && name in context[KNOWNCOLLECTIONS];
}

function addToComplexProperty(parent: componentBuilder.ComponentModule, complexProperty: ComplexProperty, elementModule: componentBuilder.ComponentModule) {
    // If property name is known collection we populate array with elements.
    var parentComponent = <any>parent.component;
    if (isKnownCollection(complexProperty.name, parent.exports)) {
        complexProperty.items.push(elementModule.component);
    } else if (parentComponent._addChildFromBuilder) {
        parentComponent._addChildFromBuilder(complexProperty.name, elementModule.component);
    } else {
        // Or simply assign the value;
        parentComponent[complexProperty.name] = elementModule.component;
    }
}

interface ComplexProperty {
    parent: componentBuilder.ComponentModule;
    name: string;
    items?: Array<any>;
}

function getExports(instance: view.View): any {
    var parent = instance.parent;

    while (parent && (<any>parent).exports === undefined) {
        parent = parent.parent;
    }

    return parent ? (<any>parent).exports : undefined;
}
