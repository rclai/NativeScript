import definition = require("ui/builder/template-builder");
import builder = require("ui/builder");
import view = require("ui/core/view");
import page = require("ui/page");
import xml = require("xml");

var KNOWNTEMPLATES = "knownTemplates";

enum State {
    EXPECTING_START,
    PARSING,
    FINISHED
}

export class TemplateBuilder {
    private _context: any;
    private _items: Array<string>;
    private _templateProperty: definition.TemplateProperty;
    private _nestingLevel: number;
    private _state: State;
    
    constructor(templateProperty: definition.TemplateProperty) {
        this._context = templateProperty.context;
        this._items = new Array<string>();
        this._templateProperty = templateProperty;
        this._nestingLevel = 0;
        this._state = State.EXPECTING_START;
    }

    public get elementName(): string {
        return this._templateProperty.elementName;
    }

    handleElement(args: xml.ParserEvent): boolean {
        if (args.eventType === xml.ParserEventType.StartElement) {
            this.addStartElement(args.prefix, args.namespace, args.elementName, args.attributes);
        } else if (args.eventType === xml.ParserEventType.EndElement) {
            this.addEndElement(args.prefix, args.elementName);
        }
        
        return this._state === State.FINISHED;
    }

    private addStartElement(prefix: string, namespace: string, elementName: string, attributes: Object) {
        if (this._state === State.EXPECTING_START) {
            this._state = State.PARSING;
        } else if (this._state === State.FINISHED) {
            throw new Error("Template must have exactly one root element but multiple elements were found.");
        } 
        this._nestingLevel++;
        this._items.push("<" +
            getElementNameWithPrefix(prefix, elementName) +
            (namespace ? " " + getNamespace(prefix, namespace) : "") +
            (attributes ? " " + getAttributesAsString(attributes) : "") +
            ">");
    }

    private addEndElement(prefix: string, elementName: string) {
        if (this._state === State.EXPECTING_START) {
            throw new Error("Template must have exactly one root element but none was found.");
        } else if (this._state === State.FINISHED) {
            throw new Error("No more closing elements expected for this template.");
        }
        
        this._nestingLevel--;
        this._items.push("</" + getElementNameWithPrefix(prefix, elementName) + ">");
        
        if (this._nestingLevel === 0) {
            this._state = State.FINISHED;
            this.build();
        }
    }

    private build() {
        if (this._templateProperty.name in this._templateProperty.parent.component) {
            var xml = this._items.join("");
            console.log("TEMPLATE: " + xml);
            var context = this._context;
            var template: view.Template = () => builder.parse(xml, context);
            this._templateProperty.parent.component[this._templateProperty.name] = template;
        }
    }
}

export function isKnownTemplate(name: string, exports: any): boolean {
    return KNOWNTEMPLATES in exports && exports[KNOWNTEMPLATES] && name in exports[KNOWNTEMPLATES];
}

function getAttributesAsString(attributes: Object): string {
    var result = [];

    for (var item in attributes) {
        result.push(item + '="' + attributes[item] + '"');
    }

    return result.join(" ");
}

function getElementNameWithPrefix(prefix: string, elementName: string): string {
    return (prefix ? prefix + ":" : "") + elementName;
}

function getNamespace(prefix: string, namespace: string): string {
    return 'xmlns:' + prefix + '="' + namespace + '"';
}