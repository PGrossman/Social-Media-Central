local LrApplication = import 'LrApplication'
local LrTasks = import 'LrTasks'
local LrHttp = import 'LrHttp'
local LrView = import 'LrView'
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
    local firstPhotoProcessed = false

    -- Tell Lightroom we want to process the renditions from this filter context
    local renditionOptions = {
        plugin = _PLUGIN,
        renditionsToSatisfy = filterContext.renditionsToSatisfy,
    }

    -- Safely loop through the exported photos
    for sourceRendition, renditionToSatisfy in filterContext:renditions(renditionOptions) do
        local success, pathOrMessage = sourceRendition:waitForRender()
        
        if success then
            table.insert(imagePaths, pathOrMessage)

            -- Grab the metadata once from the lead photo
            if not firstPhotoProcessed then
                local photo = sourceRendition.photo
                if photo then
                    -- Protected call helper to prevent crashes if a metadata field is missing
                    local function getMeta(key)
                        local status, val = pcall(function() return photo:getFormattedMetadata(key) end)
                        if status and val then return tostring(val) else return "" end
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
                    firstPhotoProcessed = true
                end
            end
        end
    end

    -- If we successfully exported images, send the payload
    if #imagePaths > 0 then
        LrTasks.startAsyncTask(function()
            local function escapeJson(str)
                if str == nil then return "" end
                str = tostring(str)
                str = string.gsub(str, "\\", "\\\\")
                str = string.gsub(str, '"', '\\"')
                str = string.gsub(str, "\n", "\\n")
                str = string.gsub(str, "\r", "\\r")
                return str
            end

            local keywordsJson = "[]"
            if metadata.keywords and metadata.keywords ~= "" then
                local kwArray = {}
                for kw in string.gmatch(metadata.keywords, "[^,]+") do
                    kw = string.match(kw, "^%s*(.-)%s*$")
                    table.insert(kwArray, '"' .. escapeJson(kw) .. '"')
                end
                keywordsJson = "[" .. table.concat(kwArray, ", ") .. "]"
            end

            local pathsJsonArray = {}
            for _, p in ipairs(imagePaths) do
                table.insert(pathsJsonArray, '"' .. escapeJson(p) .. '"')
            end
            local pathsJson = "[" .. table.concat(pathsJsonArray, ", ") .. "]"

            local payload = string.format([[
            {
                "imagePaths": %s,
                "metadata": {
                    "title": "%s",
                    "caption": "%s",
                    "keywords": %s,
                    "location": "%s",
                    "camera": "%s",
                    "lens": "%s",
                    "aperture": "%s",
                    "iso": "%s"
                }
            }
            ]], 
            pathsJson, 
            escapeJson(metadata.title), 
            escapeJson(metadata.caption), 
            keywordsJson,
            escapeJson(metadata.location), 
            escapeJson(metadata.camera), 
            escapeJson(metadata.lens), 
            escapeJson(metadata.aperture), 
            escapeJson(metadata.iso))

            local headers = {
                { field = 'Content-Type', value = 'application/json' }
            }

            -- Send the data and pop up a dialog with the result
            local response, responseHeaders = LrHttp.post('http://127.0.0.1:49152/lightroom-export', payload, headers)
            
            if response then
                LrDialogs.message("SMC Server Response", tostring(response), "info")
            else
                LrDialogs.message("Connection Failed", "Could not reach Social Media Central. Is the app running?", "critical")
            end
        end)
    else
        LrDialogs.message("Export Error", "No images were successfully rendered by Lightroom.", "critical")
    end
end

return exportFilterProvider
