local LrApplication = import 'LrApplication'
local LrHttp = import 'LrHttp'
local LrDialogs = import 'LrDialogs'

local exportFilterProvider = {}

exportFilterProvider.exportPresetFields = {
    { key = 'enabled', default = true }
}

function exportFilterProvider.sectionForFilterInDialog( f, propertyTable )
    return {
        title = "Social Media Central",
        f:row {
            f:static_text {
                title = "Images and metadata will be sent to the SMC app after export."
            }
        }
    }
end

function exportFilterProvider.postProcessRenderedPhotos(functionContext, filterContext)
    local imagePaths = {}
    local metadata = {}
    local firstPhoto = false

    for sourceRendition, renditionToSatisfy in filterContext:renditions{ plugin = _PLUGIN } do
        
        -- Extract Metadata safely BEFORE Lightroom renders the JPG and detaches the photo
        if not firstPhoto then
            local photo = sourceRendition.photo
            if photo then
                local function getMeta(key)
                    local s, val = pcall(function() return photo:getFormattedMetadata(key) end)
                    if s and val then return tostring(val) else return "" end
                end
                
                metadata = {
                    title = getMeta('title'),
                    caption = getMeta('caption'),
                    keywords = getMeta('keywordTagsForExport'),
                    location = getMeta('location'),
                    camera = getMeta('cameraModel'),
                    lens = getMeta('lens'),
                    aperture = getMeta('aperture'),
                    iso = getMeta('isoSpeedRating')
                }
                firstPhoto = true
            end
        end

        -- Now wait for Lightroom to finish applying the watermark/resize
        local success, pathOrMessage = sourceRendition:waitForRender()
        
        if success then
            table.insert(imagePaths, pathOrMessage)
        end
    end

    if #imagePaths > 0 then
        local function escape(s)
            if not s then return "" end
            s = tostring(s)
            s = string.gsub(s, "\\", "\\\\")
            s = string.gsub(s, '"', '\\"')
            s = string.gsub(s, "\n", "\\n")
            s = string.gsub(s, "\r", "\\r")
            return s
        end

        local keywordsJson = "[]"
        if metadata.keywords and metadata.keywords ~= "" then
            local kwArray = {}
            for kw in string.gmatch(metadata.keywords, "[^,]+") do
                kw = string.match(kw, "^%s*(.-)%s*$")
                table.insert(kwArray, '"' .. escape(kw) .. '"')
            end
            keywordsJson = "[" .. table.concat(kwArray, ", ") .. "]"
        end

        local pathsJson = "["
        for i, p in ipairs(imagePaths) do
            pathsJson = pathsJson .. '"' .. escape(p) .. '"'
            if i < #imagePaths then pathsJson = pathsJson .. ", " end
        end
        pathsJson = pathsJson .. "]"

        local payload = '{' ..
            '"imagePaths": ' .. pathsJson .. ',' ..
            '"metadata": {' ..
                '"title": "' .. escape(metadata.title) .. '",' ..
                '"caption": "' .. escape(metadata.caption) .. '",' ..
                '"keywords": ' .. keywordsJson .. ',' ..
                '"location": "' .. escape(metadata.location) .. '",' ..
                '"camera": "' .. escape(metadata.camera) .. '",' ..
                '"lens": "' .. escape(metadata.lens) .. '",' ..
                '"aperture": "' .. escape(metadata.aperture) .. '",' ..
                '"iso": "' .. escape(metadata.iso) .. '"' ..
            '}' ..
        '}'

        local headers = { { field = 'Content-Type', value = 'application/json' } }
        local response, respHeaders = LrHttp.post('http://127.0.0.1:49152/lightroom-export', payload, headers)
        
        if not response then
            LrDialogs.message("Connection Failed", "Could not reach Social Media Central. Please make sure the app is OPEN and try again.", "critical")
        end
    end
end

return exportFilterProvider
